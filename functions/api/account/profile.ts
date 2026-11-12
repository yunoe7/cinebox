import { isProfileStore } from "../../../lib/cinebox/profiles.mjs";
import { json, getAccount, validOrigin, type AccountEnv } from "../../_lib/account-auth.ts";

const MAX_PROFILE_BYTES = 256 * 1024;

export async function onRequestGet({ request, env }: { request: Request; env: AccountEnv }) {
  try {
    const user = await getAccount(request, env);
    if (!user) return json({ authenticated: false, error: "unauthorized" }, 401);
    const row = await env.DB.prepare("SELECT profile_json, updated_at FROM account_profile_data WHERE user_id=? LIMIT 1")
      .bind(user.id).first<{ profile_json: string; updated_at: string }>();
    if (!row) return json({ authenticated: true, profile: null, updatedAt: null });
    let profile: unknown;
    try { profile = JSON.parse(row.profile_json); } catch { return json({ error: "profile-corrupt" }, 500); }
    if (!isProfileStore(profile)) return json({ error: "profile-corrupt" }, 500);
    return json({ authenticated: true, profile, updatedAt: row.updated_at });
  } catch {
    return json({ error: "profile-unavailable" }, 503);
  }
}

export async function onRequestPut({ request, env }: { request: Request; env: AccountEnv }) {
  if (!validOrigin(request)) return json({ error: "forbidden" }, 403);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_PROFILE_BYTES) return json({ error: "profile-too-large" }, 413);
  try {
    const user = await getAccount(request, env);
    if (!user) return json({ authenticated: false, error: "unauthorized" }, 401);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_PROFILE_BYTES) return json({ error: "profile-too-large" }, 413);
    const body = JSON.parse(raw) as { profile?: unknown };
    if (!body || !isProfileStore(body.profile)) return json({ error: "invalid-profile" }, 400);
    const serialized = JSON.stringify(body.profile);
    await env.DB.prepare("INSERT INTO account_profile_data (user_id,profile_json,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json,updated_at=CURRENT_TIMESTAMP")
      .bind(user.id, serialized).run();
    return json({ saved: true });
  } catch {
    return json({ error: "profile-save-failed" }, 503);
  }
}
