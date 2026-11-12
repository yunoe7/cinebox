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
      ? (() => {
          // Discord's default avatar index is (snowflake >> 22) % 6.
          // Decimal long division avoids BigInt so this also builds on older TS targets.
          let remainder = 0;
          let quotientModulo = 0;
          for (const digit of identity.provider_user_id) {
            const current = remainder * 10 + Number(digit);
            const quotientDigit = Math.floor(current / 4194304);
            remainder = current % 4194304;
            quotientModulo = (quotientModulo * 10 + quotientDigit) % 6;
          }
          return quotientModulo;
        })()
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
