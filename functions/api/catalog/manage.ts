import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";
interface Statement { bind(...values:(string|number|null)[]):Statement; all<T>():Promise<{results:T[];success:boolean}>; run():Promise<{success:boolean}>; }
interface DB { prepare(sql:string):Statement; }
interface Env extends AdminEnv { DB?:DB; }
interface TitleRow { id:string; kind:"movie"|"series"|"video"; title:string; overview:string; release_date:string|null; poster_path:string|null; backdrop_path:string|null; genres_json:string; metadata_json:string; published:number; updated_at:string; vip_exclusive:number; vip_early_access:number; public_at:string|null; }
interface EpisodeRow { id:string; title_id:string; season_number:number; episode_number:number; title:string; overview:string; duration_seconds:number|null; thumbnail_path:string|null; metadata_json:string; }
export async function onRequestGet({request,env}:{request:Request;env:Env}){
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.DB)return json({error:"Base de données indisponible."},503);
 try{
  const titles=await env.DB.prepare("SELECT id,kind,title,overview,release_date,poster_path,backdrop_path,genres_json,metadata_json,published,updated_at,vip_exclusive,vip_early_access,public_at FROM catalog_titles ORDER BY updated_at DESC").all<TitleRow>();
  if(!titles.success)throw new Error("titles");
  const episodes=await env.DB.prepare("SELECT id,title_id,season_number,episode_number,title,overview,duration_seconds,thumbnail_path,metadata_json FROM catalog_episodes ORDER BY title_id,season_number,episode_number").all<EpisodeRow>();
  if(!episodes.success)throw new Error("episodes");
  const items=titles.results.map(t=>{let genres:unknown=[];let metadata:unknown={};try{genres=JSON.parse(t.genres_json)}catch{}try{metadata=JSON.parse(t.metadata_json)}catch{}return {...t,genres:Array.isArray(genres)?genres:[],metadata:metadata&&typeof metadata==="object"?metadata:{},episodes:episodes.results.filter(e=>e.title_id===t.id).map(e=>{let meta:unknown={};try{meta=JSON.parse(e.metadata_json)}catch{}return {...e,metadata:meta}})};});
  return json({titles:items});
 }catch{return json({error:"Impossible de charger les titres administrés."},503);}
}
export async function onRequestPatch({request,env}:{request:Request;env:Env}){
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.DB)return json({error:"Base de données indisponible."},503);
 let body:any;try{body=await request.json()}catch{return json({error:"JSON invalide."},400)}
 if(typeof body?.id!=="string"||!body.id.trim())return json({error:"Identifiant manquant."},400);
 if(typeof body.published==="boolean"){try{await env.DB.prepare("UPDATE catalog_titles SET published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.published?1:0,body.id).run();return json({updated:true,id:body.id,published:body.published});}catch{return json({error:"Changement de publication impossible."},503);}}
 const title=typeof body.title==="string"?body.title.trim().slice(0,300):null;
 const overview=typeof body.overview==="string"?body.overview.slice(0,12000):null;
 const releaseDate=typeof body.release_date==="string"?body.release_date.slice(0,20):null;
 const posterPath=body.poster_path===null?null:typeof body.poster_path==="string"&&/^\/[a-zA-Z0-9_./-]{1,240}$/.test(body.poster_path)&&!body.poster_path.includes("..")?body.poster_path:undefined;
 const backdropPath=body.backdrop_path===null?null:typeof body.backdrop_path==="string"&&/^\/[a-zA-Z0-9_./-]{1,240}$/.test(body.backdrop_path)&&!body.backdrop_path.includes("..")?body.backdrop_path:undefined;
 const vipExclusive=body.vip_exclusive===undefined?null:body.vip_exclusive===true?1:body.vip_exclusive===false?0:undefined;
 const vipEarlyAccess=body.vip_early_access===undefined?null:body.vip_early_access===true?1:body.vip_early_access===false?0:undefined;
 if(vipExclusive===undefined||vipEarlyAccess===undefined)return json({error:"Les réglages VIP doivent être des booléens."},400);
 if(vipExclusive===1&&vipEarlyAccess===1)return json({error:"Un titre ne peut pas être exclusif et en avant-première simultanément."},400);
 const publicAt=body.public_at===undefined?undefined:body.public_at===null||body.public_at===""?null:typeof body.public_at==="string"&&Number.isFinite(Date.parse(body.public_at))?new Date(body.public_at).toISOString():undefined;
 if(publicAt===undefined&&body.public_at!==undefined)return json({error:"Date de publication publique invalide."},400);
 if(vipEarlyAccess===1&&publicAt===null)return json({error:"Une date publique est nécessaire pour l'avant-première."},400);
 try{
  const current=await env.DB.prepare("SELECT id FROM catalog_titles WHERE id=?").bind(body.id).all<{id:string}>();
  if(!current.results.length)return json({error:"Titre introuvable."},404);
  await env.DB.prepare("UPDATE catalog_titles SET title=COALESCE(?,title),overview=COALESCE(?,overview),release_date=COALESCE(?,release_date),poster_path=CASE WHEN ?=1 THEN NULL ELSE COALESCE(?,poster_path) END,backdrop_path=CASE WHEN ?=1 THEN NULL ELSE COALESCE(?,backdrop_path) END,vip_exclusive=COALESCE(?,vip_exclusive),vip_early_access=COALESCE(?,vip_early_access),public_at=CASE WHEN ?=1 THEN NULL ELSE COALESCE(?,public_at) END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
   .bind(title,overview,releaseDate,body.poster_path===null?1:0,posterPath??null,body.backdrop_path===null?1:0,backdropPath??null,vipExclusive,vipEarlyAccess,body.public_at===null||body.public_at===""?1:0,publicAt??null,body.id).run();
  return json({updated:true,id:body.id});
 }catch{return json({error:"Modification impossible."},503);}
}
export async function onRequestDelete({request,env}:{request:Request;env:Env}){
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.DB)return json({error:"Base de données indisponible."},503);
 let body:any;try{body=await request.json()}catch{return json({error:"JSON invalide."},400)}
 if(typeof body?.id!=="string"||!body.id.trim())return json({error:"Identifiant manquant."},400);
 try{
  if(body.permanent===true){
   const exists=await env.DB.prepare("SELECT id FROM catalog_titles WHERE id=?").bind(body.id).all<{id:string}>();
   if(!exists.success)return json({error:"Impossible de vérifier le titre."},503);
   if(!exists.results.length)return json({error:"Titre introuvable."},404);
   // Explicit child-first deletion also works when a D1 connection does not
   // have SQLite foreign-key cascades enabled for the request.
   for(const table of ["catalog_media_sources","media_assets","user_favorites","user_progress","watch_history","catalog_episodes"]){
    const result=await env.DB.prepare(`DELETE FROM ${table} WHERE ${table==="catalog_episodes"?"title_id":"title_id"}=?`).bind(body.id).run();
    if(!result.success)throw new Error("child delete failed");
   }
   const deleted=await env.DB.prepare("DELETE FROM catalog_titles WHERE id=?").bind(body.id).run();
   if(!deleted.success)return json({error:"Suppression définitive impossible."},503);
   return json({deleted:true,id:body.id});
  }
  const result=await env.DB.prepare("UPDATE catalog_titles SET published=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.id).run();
  if(!result.success)return json({error:"Retrait du catalogue impossible."},503);
  return json({unpublished:true,id:body.id});
 }catch{return json({error:"Suppression ou retrait impossible. Vérifie les tables de la base D1."},503);}
}
