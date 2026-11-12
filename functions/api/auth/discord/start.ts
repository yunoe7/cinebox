import { json, enforceRateLimit, cookie, getAccount, randomToken, cookieHeader, type AccountEnv } from "../../../_lib/account-auth.ts";
const STATE_COOKIE="cinebox_discord_state";
export async function onRequestGet({request,env}:{request:Request;env:AccountEnv}) {
  try { if(!await enforceRateLimit(env,request,"discord_oauth_start",12,900)) return json({error:"Trop de tentatives. Réessaie dans quelques minutes."},429,{"retry-after":"900"}); }
  catch { return json({error:"Service temporairement indisponible."},503); }
  if(!env.DISCORD_CLIENT_ID || !env.DISCORD_REDIRECT_URI) return json({error:"La connexion Discord n’est pas encore configurée sur Cloudflare."},503);
  const url=new URL(request.url), mode=url.searchParams.get("mode")==="link"?"link":"login";
  if(mode==="link" && !await getAccount(request,env)) return Response.redirect(new URL("/connexion?erreur=session",request.url),302);
  const state=randomToken(32);
  const target=new URL("https://discord.com/oauth2/authorize");
  target.searchParams.set("client_id",env.DISCORD_CLIENT_ID); target.searchParams.set("response_type","code"); target.searchParams.set("redirect_uri",env.DISCORD_REDIRECT_URI); target.searchParams.set("scope","identify"); target.searchParams.set("state",state);
  const headers=new Headers({location:target.toString(),"cache-control":"no-store"});
  headers.append("set-cookie",cookieHeader(request,STATE_COOKIE,state,600,"Lax"));
  headers.append("set-cookie",cookieHeader(request,"cinebox_discord_mode",mode,600,"Lax"));
  return new Response(null,{status:302,headers});
}
