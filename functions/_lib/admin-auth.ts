import { getAccount, validOrigin, type AccountEnv } from "./account-auth.ts";

export interface AdminEnv extends Partial<AccountEnv> {
  CINEBOX_ADMIN_DISCORD_USER_ID?: string;
}

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

/** True only for a signed-in Discord account explicitly authorized as admin. */
export async function isAdminAccount(env: AdminEnv, userId: string): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const row = await env.DB.prepare(
      "SELECT 1 AS allowed FROM users u LEFT JOIN auth_identities i ON i.user_id=u.id AND i.provider='discord' WHERE u.id=? AND (u.role='admin' OR i.provider_user_id=? OR EXISTS (SELECT 1 FROM admin_allowlist a WHERE a.discord_user_id=i.provider_user_id)) LIMIT 1",
    ).bind(userId, env.CINEBOX_ADMIN_DISCORD_USER_ID || "").first<{ allowed: number }>();
    return Boolean(row?.allowed);
  } catch {
    return false;
  }
}

export function adminConfigurationError(): Response {
  return json({ error: ADMIN_CONFIG_ERROR }, 503);
}

export function adminInternalError(): Response {
  return json({ error: ADMIN_INTERNAL_ERROR }, 500);
}

export function rejectInvalidOrigin(): Response {
  return json({ error: ADMIN_ORIGIN_ERROR }, 403);
}

/**
 * Returns null when the request may proceed, or the response to send back.
 * Checks configuration first, then CSRF, then the signed HttpOnly cookie.
 */
export async function requireAdmin(request: Request, env: AdminEnv): Promise<Response | null> {
  if (!env.DB) return adminConfigurationError();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase()) && !validOrigin(request)) {
    return rejectInvalidOrigin();
  }
  try {
    const account = await getAccount(request, env as AccountEnv);
    if (!account) return json({ error: ADMIN_AUTH_ERROR }, 401);
    if (!await isAdminAccount(env, account.id)) return json({ error: "Ce compte Discord n’est pas autorisé à administrer CinéBox." }, 403);
    return null;
  } catch {
    return adminInternalError();
  }
}
