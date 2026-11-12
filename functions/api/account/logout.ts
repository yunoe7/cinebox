import { json, validOrigin, revokeAccount, clearCookie, ACCOUNT_COOKIE, type AccountEnv } from "../../_lib/account-auth.ts";
export async function onRequestPost({request,env}:{request:Request;env:AccountEnv}) {
  if(!validOrigin(request)) return json({error:"Requête refusée."},403);
  try { await revokeAccount(request,env); } catch { return json({error:"Déconnexion impossible."},503); }
  return json({authenticated:false},200,{"set-cookie":clearCookie(request,ACCOUNT_COOKIE)});
}
