import { json, validOrigin, normalizeEmail, verifyPassword, createAccountSession, type AccountEnv } from "../../_lib/account-auth.ts";
export async function onRequestPost({request,env}:{request:Request;env:AccountEnv}) {
  if(!validOrigin(request)) return json({error:"Requête refusée."},403);
  let body:unknown; try{body=await request.json();}catch{return json({error:"Corps JSON invalide."},400);}
  const data=body as Record<string,unknown>, email=normalizeEmail(data?.email), password=typeof data?.password==="string"?data.password:"";
  if(!email || !password || password.length>256) return json({error:"Adresse e-mail ou mot de passe invalide."},400);
  try {
    const user=await env.DB.prepare("SELECT id,display_name,role,email,password_hash FROM users WHERE lower(email)=? LIMIT 1").bind(email).first<{id:string;display_name:string;role:string;email:string;password_hash:string|null}>();
    if(!user?.password_hash || !await verifyPassword(password,user.password_hash)) return json({error:"Adresse e-mail ou mot de passe incorrect."},401);
    const session=await createAccountSession(request,env,user.id);
    await env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id).run();
    return json({authenticated:true,user:{id:user.id,displayName:user.display_name,email:user.email,role:user.role}},200,{"set-cookie":session.cookie});
  } catch { return json({error:"Connexion indisponible. Réessaie plus tard."},503); }
}
