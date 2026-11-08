interface Statement { bind(...values:(string|number|null)[]):Statement; all<T>():Promise<{results:T[];success:boolean}>; run():Promise<{success:boolean}>; }
interface DB { prepare(sql:string):Statement; }
interface Env { DB?:DB; CINEBOX_ADMIN_TOKEN?:string; BUNNY_STREAM_API_KEY?:string; BUNNY_STREAM_LIBRARY_ID?:string; }
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function authorized(request:Request,env:Env){const expected=env.CINEBOX_ADMIN_TOKEN||"";const h=request.headers.get("authorization")||"";const token=h.startsWith("Bearer ")?h.slice(7):"";if(expected.length<32||token.length!==expected.length)return false;let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^token.charCodeAt(i);return mismatch===0;}
export async function onRequestPost({request,env}:{request:Request;env:Env}){
 if(!authorized(request,env))return json({error:"Authentification administrateur requise."},401);
 if(!env.DB||!env.BUNNY_STREAM_API_KEY||!env.BUNNY_STREAM_LIBRARY_ID)return json({error:"Configuration Bunny ou D1 manquante."},503);
 let body:any;try{body=await request.json()}catch{return json({error:"JSON invalide."},400)}
 const id=typeof body?.videoId==="string"?body.videoId:"";
 if(!/^[a-f0-9-]{20,64}$/i.test(id))return json({error:"Identifiant Bunny invalide."},400);
 try{
  const upstream=await fetch(`https://video.bunnycdn.com/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${id}`,{method:"DELETE",headers:{AccessKey:env.BUNNY_STREAM_API_KEY,Accept:"application/json"},signal:AbortSignal.timeout(15000)});
  if(!upstream.ok&&upstream.status!==404)return json({error:upstream.status===401||upstream.status===403?"Bunny a refusé la suppression. Vérifie les droits de la clé API.":"Bunny n'a pas pu supprimer cette vidéo."},502);
  await env.DB.prepare("UPDATE catalog_episodes SET stream_uid=NULL, updated_at=CURRENT_TIMESTAMP WHERE stream_uid=?").bind(id).run();
  const titles=await env.DB.prepare("SELECT id,metadata_json FROM catalog_titles WHERE metadata_json LIKE ?").bind(`%${id}%`).all<{id:string;metadata_json:string}>();
  for(const title of titles.results){let meta:Record<string,unknown>={};try{const parsed=JSON.parse(title.metadata_json);if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))meta=parsed}catch{}if(meta.bunnyVideoId===id){delete meta.bunnyVideoId;await env.DB.prepare("UPDATE catalog_titles SET metadata_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(meta),title.id).run();}}
  return json({deleted:true,videoId:id});
 }catch{return json({error:"Erreur pendant la suppression Bunny. Vérifie la bibliothèque avant de réessayer."},503);}
}
