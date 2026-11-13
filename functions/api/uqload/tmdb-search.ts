import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";
interface Env extends AdminEnv { TMDB_READ_ACCESS_TOKEN?: string; }
type Obj=Record<string,unknown>;
function isObj(v:unknown):v is Obj{return !!v&&typeof v==="object"&&!Array.isArray(v);}
export async function onRequestPost({request,env}:{request:Request;env:Env}):Promise<Response>{
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.TMDB_READ_ACCESS_TOKEN)return json({error:"TMDB_READ_ACCESS_TOKEN indisponible côté serveur."},503);
 let body:unknown;try{body=await request.json();}catch{return json({error:"Requête invalide."},400);}
 if(!isObj(body)||typeof body.query!=="string"||!body.query.trim())return json({error:"Saisis un titre à rechercher."},400);
 const kind=body.kind==="series"?"series":"movie";
 const url=new URL(`https://api.themoviedb.org/3/search/${kind==="series"?"tv":"movie"}`);
 url.searchParams.set("query",body.query.trim().slice(0,120));url.searchParams.set("language","fr-FR");url.searchParams.set("include_adult","false");
 const token=env.TMDB_READ_ACCESS_TOKEN;const isV3=/^[a-f\d]{32}$/i.test(token);if(isV3)url.searchParams.set("api_key",token);
 const response=await fetch(url,{headers:{...(isV3?{}:{Authorization:"Bearer "+token}),Accept:"application/json"},signal:AbortSignal.timeout(12000)});
 const payload:unknown=await response.json().catch(()=>null);
 if(!response.ok||!isObj(payload))return json({error:"La recherche TMDB a échoué."},502);
 const results=Array.isArray(payload.results)?payload.results.filter(isObj).slice(0,12).map(item=>({
  id:Number(item.id),kind,title:String(item.title||item.name||""),originalTitle:String(item.original_title||item.original_name||""),
  year:String(item.release_date||item.first_air_date||"").slice(0,4),overview:String(item.overview||"").slice(0,500),
  posterPath:typeof item.poster_path==="string"?item.poster_path:null
 })).filter(item=>Number.isSafeInteger(item.id)&&item.id>0&&item.title):[];
 return json({results});
}