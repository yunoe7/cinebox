import { json, getAccount, type AccountEnv } from "../../_lib/account-auth.ts";

export async function onRequestGet({ request, env }: { request: Request; env: AccountEnv }) {
  try {
    const user = await getAccount(request, env);
    if (!user) return json({ authenticated: false, user: null });

    const identity = await env.DB.prepare(
      "SELECT provider_user_id, provider_username, provider_global_name, provider_avatar FROM auth_identities WHERE user_id=? AND provider='discord' LIMIT 1",
    ).bind(user.id).first<{
      provider_user_id: string;
      provider_username: string | null;
      provider_global_name: string | null;
      provider_avatar: string | null;
    }>();

    const defaultAvatarIndex = identity?.provider_user_id
      ? Number((BigInt(identity.provider_user_id) >> 22n) % 6n)
      : 0;
    const avatarUrl = identity?.provider_user_id
      ? identity.provider_avatar
        ? `https://cdn.discordapp.com/avatars/${identity.provider_user_id}/${identity.provider_avatar}.${identity.provider_avatar.startsWith("a_") ? "gif" : "png"}?size=256`
        : `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`
      : null;

    return json({
      authenticated: true,
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
        role: user.role,
        discord: identity ? {
          username: identity.provider_username,
          globalName: identity.provider_global_name,
          avatarUrl,
        } : null,
      },
    });
  } catch {
    return json({ authenticated: false, user: null }, 503);
  }
}
