import { json } from "../../_lib/admin-auth.ts";

/** Legacy password-session endpoint is retired; use /api/account/session. */
export async function onRequestGet() {
  return json({ authenticated: false, configured: false }, 200);
}
