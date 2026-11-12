import { json, getAccount, validOrigin, type AccountEnv } from "../../_lib/account-auth.ts";

const MAX_PROFILE_BYTES = 256 * 1024;

export async function onRequestPut({ request, env }: { request: Request; env: AccountEnv }) {
  if (!validOrigin(request)) return json({ error: "forbidden" }, 403);
  try {
    const user = await getAccount(request, env);
    if (!user) return json({ authenticated: false, error: "unauthorized" }, 401);
    const body = await request.json() as { profile?: unknown };
    if (!body || !body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) return json({ error: "invalid-profile" }, 400);
    const serialized = JSON.stringify(body.profile);
    if (new TextEncoder().encode(serialized).byteLength > MAX_PROFILE_BYTES) return json({ error: "profile-too-large" }, 413);
    await env.DB.prepare("INSERT INTO account_profile_data (user_id,profile_json,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json,updated_at=CURRENT_TIMESTAMP")
      .bind(user.id, serialized).run();
    return json({ saved: true });
  } catch {
    return json({ error: "profile-save-failed" }, 503);
  }
}
