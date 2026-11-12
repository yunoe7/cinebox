import { getAccount, json, type AccountEnv } from "../../_lib/account-auth.ts";

export async function onRequestGet({ request, env }: { request: Request; env: AccountEnv }) {
  try {
    const user = await getAccount(request, env);
    if (!user) return json({ error: "Non authentifié." }, 401);

    const identity = await env.DB.prepare(
      "SELECT provider_user_id, provider_avatar FROM auth_identities WHERE user_id=? AND provider='discord' LIMIT 1",
    ).bind(user.id).first<{ provider_user_id: string; provider_avatar: string | null }>();

    if (!identity?.provider_user_id) return json({ error: "Avatar Discord indisponible." }, 404);

    const avatarPath = identity.provider_avatar
      ? `avatars/${encodeURIComponent(identity.provider_user_id)}/${encodeURIComponent(identity.provider_avatar)}.${identity.provider_avatar.startsWith("a_") ? "gif" : "png"}`
      : `embed/avatars/0.png`;
    const upstream = await fetch(`https://cdn.discordapp.com/${avatarPath}?size=256`, {
      headers: { accept: "image/avif,image/webp,image/png,image/gif,*/*" },
    });
    if (!upstream.ok || !upstream.body) return json({ error: "Impossible de récupérer l'avatar Discord." }, 502);

    const headers = new Headers({
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    });
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const etag = upstream.headers.get("etag");
    if (etag) headers.set("etag", etag);
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return json({ error: "Service avatar temporairement indisponible." }, 503);
  }
}
