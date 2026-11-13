import { json } from "../../_lib/admin-auth.ts";

/** Legacy password-session logout endpoint is retired; use /api/account/logout. */
export async function onRequestPost() {
  return json({ authenticated: false }, 200);
}
