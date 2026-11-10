import { verifyAdminSession } from "../../../lib/cinebox/admin-auth.mjs";
import {
  buildClearedAdminCookie,
  isAdminConfigured,
  json,
  readAdminCookie,
  type AdminEnv,
} from "../../_lib/admin-auth.ts";

/**
 * GET /api/auth/session
 * Returns the session state without ever exposing the cookie value.
 * An invalid or expired cookie is cleared on the way out.
 */
export async function onRequestGet({ request, env }: { request: Request; env: AdminEnv }): Promise<Response> {
  if (!isAdminConfigured(env)) {
    return json({ authenticated: false, configured: false }, 200);
  }

  const token = readAdminCookie(request);
  if (!token) return json({ authenticated: false, configured: true }, 200);

  const session = await verifyAdminSession(token, {
    secret: env.CINEBOX_SESSION_SECRET as string,
  });
  if (!session.valid) {
    return json(
      { authenticated: false, configured: true },
      200,
      { "set-cookie": buildClearedAdminCookie(request) },
    );
  }

  return json({
    authenticated: true,
    configured: true,
    expiresAt: session.expiresAt,
  }, 200);
}
