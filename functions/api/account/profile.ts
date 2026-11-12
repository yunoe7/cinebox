import { json, getAccount, type AccountEnv } from "../../_lib/account-auth.ts";

export async function onRequestGet({ request, env }: { request: Request; env: AccountEnv }) {
  try {
    const user = await getAccount(request, env);
    if (!user) return json({ authenticated: false, error: "unauthorized" }, 401);
    const row = await env.DB.prepare("SELECT profile_json, updated_at FROM account_profile_data WHERE user_id=? LIMIT 1")
      .bind(user.id).first<{ profile_json: string; updated_at: string }>();
    if (!row) return json({ authenticated: true, profile: null, updatedAt: null });
    let profile: unknown;
    try { profile = JSON.parse(row.profile_json); } catch { return json({ error: "profile-corrupt" }, 500); }
    return json({ authenticated: true, profile, updatedAt: row.updated_at });
  } catch {
    return json({ error: "profile-unavailable" }, 503);
  }
}
