import { json } from "../../_lib/admin-auth.ts";

/** Legacy password login is intentionally disabled; administration uses Discord OAuth. */
export async function onRequestPost() {
  return json({ error: "La connexion par mot de passe est désactivée. Utilise Discord OAuth." }, 410);
}
