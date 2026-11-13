import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";
import { parseMediaSourceUrl, buildPlaybackUrl } from "../../../lib/cinebox/media-sources.mjs";
interface Statement { bind(...values:(string|number|null)[]):Statement; all<T>():Promise<{success:boolean;results:T[]}>; run():Promise<{success:boolean}>; }
interface DB { prepare(sql:string):Statement; }
interface Env extends AdminEnv { DB?:DB; UQLOAD_API_KEY?:string; }
const API="https://uqload.vc/api";
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value);}
function parseSource(value:unknown){return parseMediaSourceUrl(value);}
async function upstream(path:string,key:string,params:Record<string,string>={}){
 const url=new URL(API+path);url.searchParams.set("key",key);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 const response=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{accept:"application/json"}});
 const body=await response.json().catch(()=>null);
 if(!response.ok||!record(body)||Number(body.status)!==200)throw new Error("Uqload n’a pas accepté la requête. Vérifie la clé API et les paramètres du compte.");
 return body;
}
function resultArray(payload:Record<string,unknown>):Record<string,unknown>[] {
 const result=payload.result;
 if(Array.isArray(result))return result.filter(record);
 if(record(result)){for(const key of ["files","results","list"])if(Array.isArray(result[key]))return (result[key] as unknown[]).filter(record);}
 return [];
}
export async function onRequestGet({request,env}:{request:Request;env:Env}){
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.DB)return json({error:"Base de données indisponible."},503);

 try{
  const [titles,episodes,sources]=await Promise.all([
   // Admins must be able to attach media before publishing a catalogue title.
   env.DB.prepare("SELECT id,kind,title,published FROM catalog_titles ORDER BY title COLLATE NOCASE").all<{id:string;kind:"movie"|"series"|"video";title:string;published:number}>(),
   env.DB.prepare("SELECT id,title_id,title,season_number,episode_number FROM catalog_episodes ORDER BY title_id,season_number,episode_number").all<{id:string;title_id:string;title:string;season_number:number;episode_number:number}>(),
   env.DB.prepare("SELECT s.id,s.title_id,s.episode_id,s.provider,s.file_code,s.playback_url,s.encoding_status,s.uploaded_at,t.title,e.title AS episode_title FROM catalog_media_sources s JOIN catalog_titles t ON t.id=s.title_id LEFT JOIN catalog_episodes e ON e.id=s.episode_id ORDER BY s.updated_at DESC").all<Record<string,unknown>>()
  ]);
  const filesPayload=env.UQLOAD_API_KEY?await upstream("/file/list",env.UQLOAD_API_KEY,{per_page:"100",page:"1"}):null;
  const files=filesPayload?resultArray(filesPayload).map(f=>({file_code:String(f.file_code||f.code||""),file_title:String(f.file_title||f.title||""),status:String(f.status||"") })).filter(f=>/^[A-Za-z0-9]{6,64}$/.test(f.file_code)):[];
  return json({configured:Boolean(env.UQLOAD_API_KEY),targets:(titles.results||[]).map(t=>({...t,episodes:(episodes.results||[]).filter(e=>e.title_id===t.id)})),sources:sources.results||[],files});
 }catch(e){return json({error:e instanceof Error?e.message:"Impossible de contacter Uqload."},502);}
}
export async function onRequestPost({request,env}:{request:Request;env:Env}){
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.DB)return json({error:"Base de données indisponible."},503);
 let body:unknown;try{body=await request.json();}catch{return json({error:"JSON invalide."},400);}
 if(!record(body)||typeof body.url!=="string"||typeof body.titleId!=="string")return json({error:"URL ou contenu manquant."},400);
 const parsed=parseSource(body.url);if(!parsed)return json({error:"URL invalide : colle une URL Uqload ou Vidmoly (.me)."},400);
 const {provider,fileCode}=parsed;
 if(provider==="uqload"&&!env.UQLOAD_API_KEY)return json({error:"La clé UQLOAD_API_KEY n’est pas configurée dans Cloudflare Pages."},503);
 // Publication is not required for admin media association; the admin route remains protected by requireAdmin.
 const title=await env.DB.prepare("SELECT id,kind FROM catalog_titles WHERE id=?").bind(body.titleId).all<{id:string;kind:string}>();
 if(!title.results?.length)return json({error:"Contenu introuvable."},404);
 const episodeId=typeof body.episodeId==="string"&&body.episodeId?body.episodeId:null;
 if(episodeId){const ep=await env.DB.prepare("SELECT id FROM catalog_episodes WHERE id=? AND title_id=?").bind(episodeId,body.titleId).all<{id:string}>();if(!ep.results?.length||title.results[0].kind!=="series")return json({error:"Épisode invalide pour cette série."},400);}
 try{
  const info=provider==="uqload"?await upstream("/file/info",env.UQLOAD_API_KEY!,{file_code:fileCode}):null;
  const data=info&&record(info.result)?info.result:{};
  const playbackUrl=buildPlaybackUrl(fileCode,provider)!;
  await env.DB.prepare("INSERT INTO catalog_media_sources (id,title_id,episode_id,provider,file_code,video_id,playback_url,quality,encoding_status,uploaded_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider,file_code) DO UPDATE SET title_id=excluded.title_id,episode_id=excluded.episode_id,video_id=excluded.video_id,playback_url=excluded.playback_url,quality=excluded.quality,encoding_status=excluded.encoding_status,uploaded_at=excluded.uploaded_at,updated_at=CURRENT_TIMESTAMP")
   .bind(crypto.randomUUID(),body.titleId,episodeId,provider,fileCode,fileCode,playbackUrl,typeof data.file_quality==="string"?data.file_quality:null,"ready",typeof data.created==="string"?new Date(data.created).toISOString():null).run();
  return json({associated:true,provider,fileCode,titleId:body.titleId,episodeId,playbackUrl});
 }catch(e){return json({error:e instanceof Error?e.message:"Association Uqload impossible."},502);}
}
