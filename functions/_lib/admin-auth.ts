import {
  ADMIN_SESSION_TTL_SECONDS,
  buildClearSessionCookie,
  buildSessionCookie,
  parsePasswordHash,
  readCookie,
  sessionCookieName,
  verifyAdminSession,
  verifyRequestOrigin,
} from "../../lib/cinebox/admin-auth.mjs";

export interface AdminEnv {
  CINEBOX_ADMIN_PASSWORD_HASH?: string;
  CINEBOX_SESSION_SECRET?: string;
}

export const ADMIN_AUTH_ERROR = "Authentification administrateur requise.";
export const ADMIN_SESSION_EXPIRED_ERROR = "Session administrateur expirée. Reconnecte-toi.";
export const ADMIN_ORIGIN_ERROR = "Requête refusée : origine invalide.";
export const ADMIN_CONFIG_ERROR = "L'administration n'est pas configurée côté serveur.";

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

export function isSecureRequest(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function isAdminConfigured(env: AdminEnv): boolean {
  return parsePasswordHash(env.CINEBOX_ADMIN_PASSWORD_HASH) !== null &&
    typeof env.CINEBOX_SESSION_SECRET === "string" &&
    env.CINEBOX_SESSION_SECRET.length >= 32;
}

export function adminConfigurationError(): Response {
  return json({ error: ADMIN_CONFIG_ERROR }, 503);
}

export function readAdminCookie(request: Request): string {
  return readCookie(
    request.headers.get("cookie"),
    sessionCookieName({ secure: isSecureRequest(request) }),
  );
}

export function buildAdminCookie(request: Request, token: string): string {
  return buildSessionCookie(token, {
    secure: isSecureRequest(request),
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

export function buildClearedAdminCookie(request: Request): string {
  return buildClearSessionCookie({ secure: isSecureRequest(request) });
}

export function rejectInvalidOrigin(): Response {
  return json({ error: ADMIN_ORIGIN_ERROR }, 403);
}

/**
 * Returns null when the request may proceed, or the response to send back.
 * Checks configuration first, then CSRF, then the signed HttpOnly cookie.
 */
export async function requireAdmin(
  request: Request,
  env: AdminEnv,
): Promise<Response | null> {
  if (!isAdminConfigured(env)) return adminConfigurationError();
  const origin = verifyRequestOrigin(request);
  if (!origin.ok) return rejectInvalidOrigin();
  const token = readAdminCookie(request);
  if (!token) return json({ error: ADMIN_AUTH_ERROR }, 401);
  const session = await verifyAdminSession(token, { secret: env.CINEBOX_SESSION_SECRET as string });
  if (!session.valid) return json({ error: ADMIN_SESSION_EXPIRED_ERROR }, 401);
  return null;
}
