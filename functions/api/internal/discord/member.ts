import { json, type AccountEnv } from "../../../_lib/account-auth.ts";

function safeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

export async function onRequestPost({ request, env }: { request: Request; env: AccountEnv }) {
  if (!env.CINEBOX_BOT_API_SECRET) return json({ error: "service-unavailable" }, 503);
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supplied || !safeEqual(supplied, env.CINEBOX_BOT_API_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 1024) return json({ error: "payload-too-large" }, 413);

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1024) return json({ error: "payload-too-large" }, 413);
    const body = JSON.parse(raw) as { discordUserId?: unknown };
    if (typeof body.discordUserId !== "string" || !/^\d{17,20}$/.test(body.discordUserId)) {
      return json({ error: "invalid-discord-user-id" }, 400);
    }

    const account = await env.DB.prepare(
      "SELECT u.display_name, u.role FROM auth_identities i JOIN users u ON u.id=i.user_id WHERE i.provider='discord' AND i.provider_user_id=? LIMIT 1",
    ).bind(body.discordUserId).first<{ display_name: string; role: string }>();

    if (!account) return json({ linked: false });
    return json({
      linked: true,
      account: {
        displayName: account.display_name,
        role: account.role,
      },
    });
  } catch {
    return json({ error: "lookup-unavailable" }, 503);
  }
}
