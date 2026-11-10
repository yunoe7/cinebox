import { verifyRequestOrigin } from "../../../lib/cinebox/admin-auth.mjs";
import {
  buildClearedAdminCookie,
  json,
  rejectInvalidOrigin,
} from "../../_lib/admin-auth.ts";

/**
 * POST /api/auth/logout
 * Clears the HttpOnly cookie in the browser. The session is stateless, so
 * clearing the cookie is the invalidation mechanism for this device.
 */
export async function onRequestPost({ request }: { request: Request }): Promise<Response> {
  const origin = verifyRequestOrigin(request);
  if (!origin.ok) return rejectInvalidOrigin();
  return json(
    { authenticated: false },
    200,
    { "set-cookie": buildClearedAdminCookie(request) },
  );
}
