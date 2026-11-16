import { cookie, clearCookie, cookieHeader, getAccount, createAccountSession, type AccountEnv } from "../../../_lib/account-auth.ts";
const STATE_COOKIE="cinebox_discord_state";

export async function onRequestGet({request,env}:{request:Request;env:AccountEnv}) {
  const url=new URL(request.url), state=url.searchParams.get("state")||"", code=url.searchParams.get("code")||"";
  const stateCookie=cookie(request,STATE_COOKIE), mode=cookie(request,"cinebox_discord_mode");
  const fail=(reason:string)=>{
    const headers=new Headers({
      location:new URL("/connexion?erreur="+encodeURIComponent(reason),request.url).toString(),
      "cache-control":"no-store",
    });
    headers.append("set-cookie",clearCookie(request,STATE_COOKIE));
    headers.append("set-cookie",clearCookie(request,"cinebox_discord_mode"));
    return new Response(null,{status:302,headers});
  };
  if(!state || !stateCookie || state!==stateCookie || !code) return fail("discord-state");
  if(!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) return fail("discord-config");
  try {
    const form=new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:env.DISCORD_REDIRECT_URI});
    const tokenResponse=await fetch("https://discord.com/api/oauth2/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});
    if(!tokenResponse.ok) return fail("discord-token");
    const token=await tokenResponse.json() as {access_token?:string;token_type?:string};
    if(!token.access_token) return fail("discord-token");
    const profileResponse=await fetch("https://discord.com/api/users/@me",{headers:{authorization:`${token.token_type||"Bearer"} ${token.access_token}`}});
    if(!profileResponse.ok) return fail("discord-profile");
    const profile=await profileResponse.json() as {id?:string;username?:string;global_name?:string|null;avatar?:string|null};
    if(!profile.id || !profile.username) return fail("discord-profile");
    let userId:string;
    if(mode==="link") {
      const current=await getAccount(request,env); if(!current) return fail("session");
      const linked=await env.DB.prepare("SELECT user_id FROM auth_identities WHERE provider='discord' AND provider_user_id=?").bind(profile.id).first<{user_id:string}>();
      if(linked && linked.user_id!==current.id) return fail("discord-already-linked");
      const linkResult = await env.DB.prepare("INSERT INTO auth_identities (id,user_id,provider,provider_user_id,provider_username,provider_global_name,provider_avatar) VALUES (?, ?, 'discord', ?, ?, ?, ?) ON CONFLICT(provider,provider_user_id) DO UPDATE SET provider_username=excluded.provider_username,provider_global_name=excluded.provider_global_name,provider_avatar=excluded.provider_avatar WHERE auth_identities.user_id=excluded.user_id").bind(crypto.randomUUID(),current.id,profile.id,profile.username,profile.global_name||null,profile.avatar||null).run();
      const linkChanges = linkResult && typeof linkResult === "object" && "meta" in linkResult && linkResult.meta && typeof linkResult.meta === "object" && "changes" in linkResult.meta ? linkResult.meta.changes : undefined;
      if (linkResult && typeof linkResult === "object" && "success" in linkResult && linkResult.success === false || linkChanges === 0) return fail("discord-already-linked");
      userId=current.id;
    } else {
      const linked=await env.DB.prepare("SELECT user_id FROM auth_identities WHERE provider='discord' AND provider_user_id=?").bind(profile.id).first<{user_id:string}>();
      if(linked) {
        userId=linked.user_id;
        await env.DB.prepare(
          "UPDATE auth_identities SET provider_username=?,provider_global_name=?,provider_avatar=? WHERE provider='discord' AND provider_user_id=?",
        ).bind(profile.username,profile.global_name||null,profile.avatar||null,profile.id).run();
      } else {
        userId=crypto.randomUUID();
        const displayName=(profile.global_name||profile.username).slice(0,80);
        await env.DB.batch([
          env.DB.prepare("INSERT INTO users (id,display_name,role) VALUES (?,?,'user')").bind(userId,displayName),
          env.DB.prepare("INSERT INTO auth_identities (id,user_id,provider,provider_user_id,provider_username,provider_global_name,provider_avatar) VALUES (?,?,'discord',?,?,?,?)").bind(crypto.randomUUID(),userId,profile.id,profile.username,profile.global_name||null,profile.avatar||null)
        ]);
      }
    }
    const session=await createAccountSession(request,env,userId);
    const headers=new Headers({location:new URL(mode==="link"?"/connexion?discord=lie":mode==="admin"?"/?admin=1&connexion=discord":"/?connexion=discord",request.url).toString(),"cache-control":"no-store","set-cookie":session.cookie});
    headers.append("set-cookie",clearCookie(request,STATE_COOKIE)); headers.append("set-cookie",clearCookie(request,"cinebox_discord_mode"));
    return new Response(null,{status:302,headers});
  } catch { return fail("discord-unavailable"); }
}
