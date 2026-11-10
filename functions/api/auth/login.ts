import {
  ADMIN_SESSION_TTL_SECONDS,
  AdminPasswordCryptoError,
  createAdminSession,
  verifyAdminPassword,
  verifyRequestOrigin,
} from "../../../lib/cinebox/admin-auth.mjs";
import {
  adminConfigurationError,
  adminInternalError,
  buildAdminCookie,
  isAdminConfigured,
  json,
  rejectInvalidOrigin,
  type AdminEnv,
} from "../../_lib/admin-auth.ts";

/**
 * POST /api/auth/login
 * Verifies the admin password with PBKDF2 and issues a signed HttpOnly cookie.
 * The password and its verifier are never returned or logged.
 */
export async function onRequestPost({ request, env }: { request: Request; env: AdminEnv }): Promise<Response> {
  if (!isAdminConfigured(env)) return adminConfigurationError();

  const origin = verifyRequestOrigin(request);
  if (!origin.ok) return rejectInvalidOrigin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corps JSON invalide." }, 400);
  }

  const password = body && typeof body === "object" && !Array.isArray(body) &&
    typeof (body as { password?: unknown }).password === "string"
    ? (body as { password: string }).password
    : "";
  if (!password || password.length > 1024) {
    return json({ error: "Mot de passe administrateur requis." }, 400);
  }

  let valid: boolean;
  try {
    valid = await verifyAdminPassword(password, env.CINEBOX_ADMIN_PASSWORD_HASH);
  } catch (error) {
    // A crypto/internal failure is not a wrong password. Log a fixed line only:
    // the password, the verifier and the salt must never reach the logs.
    if (error instanceof AdminPasswordCryptoError) {
      console.error("Admin login: PBKDF2 verifier failure.");
    } else {
      console.error("Admin login: unexpected verifier failure.");
    }
    return adminInternalError();
  }
  if (!valid) {
    return json({ error: "Mot de passe administrateur incorrect." }, 401);
  }

  const session = await createAdminSession({
    secret: env.CINEBOX_SESSION_SECRET as string,
    ttlSeconds: ADMIN_SESSION_TTL_SECONDS,
  });
  return json(
    { authenticated: true, expiresAt: session.expiresAt },
    200,
    { "set-cookie": buildAdminCookie(request, session.token) },
  );
}
