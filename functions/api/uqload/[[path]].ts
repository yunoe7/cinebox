import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";
import { parseMediaSourceUrl, buildPlaybackUrl, normalizePlaybackUrl, encodingStatusFromCanplay } from "../../../lib/cinebox/media-sources.mjs";
interface Statement { bind(...values:(string|number|null)[]):Statement; all<T>():Promise<{success:boolean;results:T[]}>; run():Promise<{success:boolean;meta?:{changes?:number}}>; }
interface DB { prepare(sql:string):Statement; }
interface Env extends AdminEnv { DB?:DB; UQLOAD_API_KEY?:string; }
const API="https://uqload.vc/api";
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==="object"&&!Array.isArray(value);}
function parseSource(value:unknown){return parseMediaSourceUrl(value);}
function uploadedAtFromInfo(data:Record<string,unknown>):string|null{
 const raw=data.uploaded??data.created;
 if(typeof raw!=="string"||!raw.trim())return null;
 const date=new Date(raw);
 return Number.isNaN(date.getTime())?null:date.toISOString();
}
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
/**
 * `/file/info` documents `result` as an array. Accept both shapes so a legacy
 * or proxied response cannot break the association.
 */
function infoRecord(payload:Record<string,unknown>|null):Record<string,unknown>{
 const result=payload?.result;
 if(Array.isArray(result))return record(result[0])?result[0]:{};
 return record(result)?result:{};
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
  // The Uqload listing is a convenience. A Uqload outage must not hide the
  // D1 catalogue nor the Vidmoly sources, so its failure is reported, not thrown.
  let files:Array<{file_code:string;file_title:string;status:string;canplay:number|null}>=[];let upstreamError:string|null=null;
  if(env.UQLOAD_API_KEY){
   try{
    const filesPayload=await upstream("/file/list",env.UQLOAD_API_KEY,{per_page:"100",page:"1"});
    files=resultArray(filesPayload).map(f=>{
     const canplay=Number(f.canplay);
     return {
      file_code:String(f.file_code||f.code||""),
      file_title:String(f.file_title||f.title||""),
      status:String(f.status||""),
      canplay:Number.isFinite(canplay)?canplay:null,
     };
    }).filter(f=>/^[A-Za-z0-9]{6,64}$/.test(f.file_code));
   }catch(e){upstreamError=e instanceof Error?e.message:"Impossible de contacter Uqload.";}
  }
  return json({
   configured:Boolean(env.UQLOAD_API_KEY),
   targets:(titles.results||[]).map(t=>({...t,episodes:(episodes.results||[]).filter(e=>e.title_id===t.id)})),
   // Legacy rows keep their stored value in D1; the canonical URL is derived
   // for display only, so old sources can be checked without any write.
   sources:(sources.results||[]).map(source=>{
    const canonical=normalizePlaybackUrl(source.playback_url)||buildPlaybackUrl(source.file_code,source.provider);
    return {...source,canonical_playback_url:canonical,legacy_playback_url:Boolean(canonical&&source.playback_url&&canonical!==source.playback_url)};
   }),
   files,
   upstreamError,
  });
 }catch(e){return json({error:e instanceof Error?e.message:"Impossible de contacter Uqload."},502);}
}
export async function onRequestPost({request,env}:{request:Request;env:Env}){
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.DB)return json({error:"Base de données indisponible."},503);
 let body:unknown;try{body=await request.json();}catch{return json({error:"JSON invalide."},400);}
 if(!record(body)||typeof body.url!=="string"||typeof body.titleId!=="string")return json({error:"URL ou contenu manquant."},400);
 const parsed=parseSource(body.url);if(!parsed)return json({error:"URL invalide : colle une URL Uqload (.vc) ou Vidmoly (.org, .biz, .to, .net, .me)."},400);
 const {provider,fileCode}=parsed;
 if(provider==="uqload"&&!env.UQLOAD_API_KEY)return json({error:"La clé UQLOAD_API_KEY n’est pas configurée dans Cloudflare Pages."},503);
 // Publication is not required for admin media association; the admin route remains protected by requireAdmin.
 const title=await env.DB.prepare("SELECT id,kind FROM catalog_titles WHERE id=?").bind(body.titleId).all<{id:string;kind:string}>();
 if(!title.results?.length)return json({error:"Contenu introuvable."},404);
 const episodeId=typeof body.episodeId==="string"&&body.episodeId?body.episodeId:null;
 if(episodeId){const ep=await env.DB.prepare("SELECT id FROM catalog_episodes WHERE id=? AND title_id=?").bind(episodeId,body.titleId).all<{id:string}>();if(!ep.results?.length||title.results[0].kind!=="series")return json({error:"Épisode invalide pour cette série."},400);}
 // A provider/file code identifies one unique remote video. Never let a
 // routine manual import silently move a source to another title or episode.
 const existing=await env.DB.prepare("SELECT id,title_id,episode_id FROM catalog_media_sources WHERE provider=? AND file_code=? LIMIT 1").bind(provider,fileCode).all<{id:string;title_id:string;episode_id:string|null}>();
 const current=existing.results?.[0];
 if(current&&(current.title_id!==body.titleId.trim()||current.episode_id!==(episodeId??null))){
  return json({error:"Cette source vidéo est déjà associée à un autre contenu ou épisode. Aucun changement n’a été effectué.",code:"SOURCE_ALREADY_ASSOCIATED",existingTitleId:current.title_id,existingEpisodeId:current.episode_id},409);
 }
 try{
  const info=provider==="uqload"?await upstream("/file/info",env.UQLOAD_API_KEY!,{file_code:fileCode}):null;
  const data=infoRecord(info);
  const playbackUrl=buildPlaybackUrl(fileCode,provider,parsed.host)!;
  // Uqload reports encoding state through `canplay`; Vidmoly links are direct.
  const encodingStatus=provider==="uqload"?encodingStatusFromCanplay(data.canplay):"ready";
  const quality=typeof data.file_quality==="string"?data.file_quality:typeof data.quality==="string"?data.quality:null;
  const saved=await env.DB.prepare("INSERT INTO catalog_media_sources (id,title_id,episode_id,provider,file_code,video_id,playback_url,quality,encoding_status,uploaded_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider,file_code) DO UPDATE SET title_id=excluded.title_id,episode_id=excluded.episode_id,video_id=excluded.video_id,playback_url=excluded.playback_url,quality=excluded.quality,encoding_status=excluded.encoding_status,uploaded_at=excluded.uploaded_at,updated_at=CURRENT_TIMESTAMP WHERE catalog_media_sources.title_id=excluded.title_id AND catalog_media_sources.episode_id IS excluded.episode_id")
   .bind(crypto.randomUUID(),body.titleId.trim(),episodeId,provider,fileCode,fileCode,playbackUrl,quality,encodingStatus,uploadedAtFromInfo(data)).run();
  if(!saved.success)return json({error:"D1 n’a pas enregistré l’association de la source vidéo."},503);
  if(saved.meta?.changes===0)return json({error:"Cette source vidéo a été associée à un autre contenu ou épisode entre-temps. Aucun changement n’a été effectué.",code:"SOURCE_ALREADY_ASSOCIATED"},409);
  return json({associated:true,provider,fileCode,titleId:body.titleId.trim(),episodeId,playbackUrl,encodingStatus});
 }catch(e){return json({error:e instanceof Error?e.message:"Association Uqload impossible."},502);}
}
