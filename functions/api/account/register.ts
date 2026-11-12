import { json, validOrigin, normalizeEmail, passwordHash, createAccountSession, type AccountEnv } from "../../_lib/account-auth.ts";
export async function onRequestPost({request,env}:{request:Request;env:AccountEnv}) {
  if(!validOrigin(request)) return json({error:"Requête refusée."},403);
  let body: unknown; try { body=await request.json(); } catch { return json({error:"Corps JSON invalide."},400); }
  const data=body as Record<string,unknown>, email=normalizeEmail(data?.email), password=typeof data?.password==="string"?data.password:"", displayName=typeof data?.displayName==="string"?data.displayName.trim().slice(0,80):"";
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) return json({error:"Adresse e-mail invalide."},400);
  if(password.length<12 || password.length>256) return json({error:"Le mot de passe doit contenir entre 12 et 256 caractères."},400);
  if(!displayName) return json({error:"Choisis un nom d’affichage."},400);
  try {
    const existing=await env.DB.prepare("SELECT id FROM users WHERE lower(email)=? LIMIT 1").bind(email).first();
    if(existing) return json({error:"Un compte utilise déjà cette adresse e-mail."},409);
    const id=crypto.randomUUID(), hash=await passwordHash(password);
    await env.DB.prepare("INSERT INTO users (id,display_name,role,email,password_hash) VALUES (?,?, 'user', ?, ?)").bind(id,displayName,email,hash).run();
    const session=await createAccountSession(request,env,id);
    return json({authenticated:true,user:{id,displayName,email,role:"user"},emailVerified:false},201,{"set-cookie":session.cookie});
  } catch { return json({error:"Inscription indisponible. Vérifie la configuration des comptes."},503); }
}
