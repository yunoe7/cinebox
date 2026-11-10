import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";

interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean }>;
}
interface DB {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Array<{ success: boolean }>>;
}
interface Env extends AdminEnv { DB?: DB; }
interface TitleRow { id:string; kind:"movie"|"series"|"video"; title:string; overview:string; release_date:string|null; poster_path:string|null; backdrop_path:string|null; genres_json:string; metadata_json:string; published:number; updated_at:string; }
interface EpisodeRow { id:string; title_id:string; season_number:number; episode_number:number; title:string; overview:string; duration_seconds:number|null; stream_uid:string|null; thumbnail_path:string|null; metadata_json:string; }
function parseMetadata(value:string):Record<string,unknown>{try{const parsed:unknown=JSON.parse(value);if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))return parsed as Record<string,unknown>}catch{}return {};}
export async function onRequestGet({request,env}:{request:Request;env:Env}){
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.DB)return json({error:"Base de données indisponible."},503);
 try{
  const titles=await env.DB.prepare("SELECT id,kind,title,overview,release_date,poster_path,backdrop_path,genres_json,metadata_json,published,updated_at FROM catalog_titles ORDER BY updated_at DESC").all<TitleRow>();
  if(!titles.success)throw new Error("titles");
  const episodes=await env.DB.prepare("SELECT id,title_id,season_number,episode_number,title,overview,duration_seconds,stream_uid,thumbnail_path,metadata_json FROM catalog_episodes ORDER BY title_id,season_number,episode_number").all<EpisodeRow>();
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
 if(typeof body.detachVideoId==="string"&&/^[a-f0-9-]{20,64}$/i.test(body.detachVideoId)){
  const videoId=body.detachVideoId;
  try{
   const row=await env.DB.prepare("SELECT metadata_json FROM catalog_titles WHERE id=?").bind(body.id).all<{metadata_json:string}>();
   if(!row.success)throw new Error("read");
   if(!row.results[0])return json({error:"Titre introuvable."},404);
   const current=row.results[0].metadata_json;
   const meta=parseMetadata(current);
   const titleReferenced=meta.bunnyVideoId===videoId;
   const statements:Statement[]=[
    env.DB.prepare("UPDATE catalog_episodes SET stream_uid=NULL, updated_at=CURRENT_TIMESTAMP WHERE title_id=? AND stream_uid=?").bind(body.id,videoId),
   ];
   if(titleReferenced){
    delete meta.bunnyVideoId;
    statements.push(env.DB.prepare("UPDATE catalog_titles SET metadata_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND metadata_json=?").bind(JSON.stringify(meta),body.id,current));
   }
   const results=await env.DB.batch(statements);
   if(results.some(result=>!result.success))throw new Error("detach");
   const verify=await env.DB.prepare("SELECT metadata_json FROM catalog_titles WHERE id=?").bind(body.id).all<{metadata_json:string}>();
   if(!verify.success)throw new Error("verify");
   if(parseMetadata(verify.results[0]?.metadata_json??"").bunnyVideoId===videoId)return json({error:"La fiche a été modifiée entre-temps. Vérifie l'état puis réessaie.",conflict:true},409);
   const remaining=await env.DB.prepare("SELECT id FROM catalog_episodes WHERE title_id=? AND stream_uid=? LIMIT 1").bind(body.id,videoId).all<{id:string}>();
   if(!remaining.success)throw new Error("verify-episodes");
   if(remaining.results.length>0)return json({error:"Une association a été recréée entre-temps. Vérifie l'état puis réessaie.",conflict:true},409);
   return json({detached:true,id:body.id,titleDetached:titleReferenced});
  }catch{return json({error:"Dissociation impossible."},503);}
 }
 if(typeof body.published==="boolean"){try{await env.DB.prepare("UPDATE catalog_titles SET published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.published?1:0,body.id).run();return json({updated:true,id:body.id,published:body.published});}catch{return json({error:"Changement de publication impossible."},503);}}
 const title=typeof body.title==="string"?body.title.trim().slice(0,300):null;
 const overview=typeof body.overview==="string"?body.overview.slice(0,12000):null;
 const releaseDate=typeof body.release_date==="string"?body.release_date.slice(0,20):null;
 const posterPath=body.poster_path===null?null:typeof body.poster_path==="string"&&/^\/[a-zA-Z0-9_./-]{1,240}$/.test(body.poster_path)&&!body.poster_path.includes("..")?body.poster_path:undefined;
 const backdropPath=body.backdrop_path===null?null:typeof body.backdrop_path==="string"&&/^\/[a-zA-Z0-9_./-]{1,240}$/.test(body.backdrop_path)&&!body.backdrop_path.includes("..")?body.backdrop_path:undefined;
 try{
  const current=await env.DB.prepare("SELECT id FROM catalog_titles WHERE id = ?").bind(body.id).all<{id:string}>();
  if(!current.results.length)return json({error:"Titre introuvable."},404);
  await env.DB.prepare("UPDATE catalog_titles SET title=COALESCE(?,title), overview=COALESCE(?,overview), release_date=COALESCE(?,release_date), poster_path=CASE WHEN ?=1 THEN NULL ELSE COALESCE(?,poster_path) END, backdrop_path=CASE WHEN ?=1 THEN NULL ELSE COALESCE(?,backdrop_path) END, updated_at=CURRENT_TIMESTAMP WHERE id=?")
   .bind(title,overview,releaseDate,body.poster_path===null?1:0,posterPath??null,body.backdrop_path===null?1:0,backdropPath??null,body.id).run();
  return json({updated:true,id:body.id});
 }catch{return json({error:"Modification impossible."},503);}
}
export async function onRequestDelete({request,env}:{request:Request;env:Env}){
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.DB)return json({error:"Base de données indisponible."},503);
 let body:any;try{body=await request.json()}catch{return json({error:"JSON invalide."},400)}
 if(typeof body?.id!=="string"||!body.id.trim())return json({error:"Identifiant manquant."},400);
 try{
  const result=await env.DB.prepare("UPDATE catalog_titles SET published=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.id).run();
  if(!result.success)return json({error:"Retrait du catalogue impossible."},503);
  return json({unpublished:true,id:body.id});
 }catch{return json({error:"Retrait du catalogue impossible."},503);}
}
