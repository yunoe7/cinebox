import { getAccount, validOrigin, type AccountEnv } from "./account-auth.ts";

export interface AdminEnv extends AccountEnv {}

export const ADMIN_AUTH_ERROR = "Authentification administrateur requise.";
export const ADMIN_SESSION_EXPIRED_ERROR = "Session Discord expirée. Reconnecte-toi.";
export const ADMIN_ORIGIN_ERROR = "Requête refusée : origine invalide.";
export const ADMIN_CONFIG_ERROR = "La connexion Discord ou la base de données administrateur n’est pas configurée.";
export const ADMIN_INTERNAL_ERROR = "Erreur serveur. Réessaie plus tard.";

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function adminConfigurationError(): Response {
  return json({ error: "L'administration n'est pas configurée côté serveur." }, 503);
}
export function adminInternalError(): Response {
  return json({ error: ADMIN_INTERNAL_ERROR }, 500);
}
export function rejectInvalidOrigin(): Response {
  return json({ error: ADMIN_ORIGIN_ERROR }, 403);
}

/**
 * Discord role checks are performed server-side with the bot token.
 * A short per-isolate cache avoids repeatedly hitting Discord during a burst
 * of admin API requests; permission revocations propagate within 30 seconds.
 */
const roleCache = new Map<string, { allowed: boolean; expiresAt: number }>();
const ROLE_CACHE_TTL_MS = 30_000;

async function hasPrivilegedDiscordRole(env: AdminEnv, discordUserId: string): Promise<boolean> {
  const roleIds = [
    env.CINEBOX_DISCORD_ROLE_FONDA_ID,
    env.CINEBOX_DISCORD_ROLE_ADMIN_ID,
    env.CINEBOX_DISCORD_ROLE_MODO_ID,
  ].filter((value): value is string => Boolean(value && /^\d{17,20}$/.test(value)));
  if (!env.CINEBOX_DISCORD_BOT_TOKEN || !env.CINEBOX_DISCORD_GUILD_ID || !roleIds.length) return false;
  if (!/^\d{17,20}$/.test(env.CINEBOX_DISCORD_GUILD_ID)) return false;

  const cacheKey = `${env.CINEBOX_DISCORD_GUILD_ID}:${discordUserId}`;
  const cached = roleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  try {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${env.CINEBOX_DISCORD_GUILD_ID}/members/${discordUserId}`,
      { headers: { authorization: `Bot ${env.CINEBOX_DISCORD_BOT_TOKEN}`, accept: "application/json" } },
    );
    if (!response.ok) {
      if (response.status === 404) roleCache.set(cacheKey, { allowed: false, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
      return false;
    }
    const member = await response.json() as { roles?: unknown };
    const memberRoles = Array.isArray(member.roles) ? member.roles.filter((id): id is string => typeof id === "string") : [];
    const allowed = roleIds.some(roleId => memberRoles.includes(roleId));
    roleCache.set(cacheKey, { allowed, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
    return allowed;
  } catch {
    // Fail closed if Discord cannot confirm the member's current roles.
    return false;
  }
}

/** True only for an account explicitly allowed or holding a configured staff role. */
export async function isAdminAccount(env: AdminEnv, userId: string): Promise<boolean> {
  if (!env.DB) return false;
  try {
    // Keep existing explicit grants (owner ID, database admin role, allowlist).
    const explicit = await env.DB.prepare(
      "SELECT 1 AS allowed FROM users u LEFT JOIN auth_identities i ON i.user_id=u.id AND i.provider='discord' WHERE u.id=? AND (u.role='admin' OR i.provider_user_id=? OR EXISTS (SELECT 1 FROM admin_allowlist a WHERE a.discord_user_id=i.provider_user_id)) LIMIT 1",
    ).bind(userId, env.CINEBOX_ADMIN_DISCORD_USER_ID || "").first<{ allowed: number }>();
    if (explicit?.allowed) return true;

    // Otherwise inspect the linked Discord identity and resolve its current guild roles.
    if (!env.CINEBOX_DISCORD_BOT_TOKEN || !env.CINEBOX_DISCORD_GUILD_ID) return false;
    const identity = await env.DB.prepare(
      "SELECT provider_user_id FROM auth_identities WHERE user_id=? AND provider='discord' LIMIT 1",
    ).bind(userId).first<{ provider_user_id: string }>();
    if (!identity?.provider_user_id) return false;
    return await hasPrivilegedDiscordRole(env, identity.provider_user_id);
  } catch {
    return false;
  }
}

/**
 * Returns null when the request may proceed, or the response to send back.
 * Checks configuration, CSRF, the Discord account session and current staff roles.
 */
export async function requireAdmin(request: Request, env: AdminEnv): Promise<Response | null> {
  if (!env.DB) return json({ error: "Base de données indisponible." }, 503);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase()) && !validOrigin(request)) {
    return rejectInvalidOrigin();
  }
  try {
    const account = await getAccount(request, env);
    if (!account) return json({ error: ADMIN_AUTH_ERROR }, 401);
    if (!await isAdminAccount(env, account.id)) {
      return json({ error: "Ton compte Discord ne possède pas le rôle Fondateur, Admin ou Modérateur requis." }, 403);
    }
    return null;
  } catch {
    return adminInternalError();
  }
}
