import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";
interface Statement{bind(...values:(string|number|null)[]):Statement;all<T>():Promise<{success:boolean;results:T[]}>;run():Promise<{success:boolean}>;}
interface DB{prepare(sql:string):Statement;}
interface Env extends AdminEnv{DB?:DB;TMDB_READ_ACCESS_TOKEN?:string;}
type Obj=Record<string,unknown>;
function isObj(v:unknown):v is Obj{return !!v&&typeof v==="object"&&!Array.isArray(v);}
function clean(v:unknown,max=12000):string{return typeof v==="string"?v.trim().slice(0,max):"";}
async function tmdb(path:string,token:string):Promise<Obj>{
 const url=new URL("https://api.themoviedb.org/3"+path);url.searchParams.set("language","fr-FR");
 const isV3=/^[a-f\d]{32}$/i.test(token);if(isV3)url.searchParams.set("api_key",token);
 const r=await fetch(url,{headers:{...(isV3?{}:{Authorization:"Bearer "+token}),Accept:"application/json"},signal:AbortSignal.timeout(12000)});
 const data:unknown=await r.json().catch(()=>null);if(!r.ok||!isObj(data))throw new Error("Impossible de récupérer la fiche TMDB.");return data;
}
export async function onRequestPost({request,env}:{request:Request;env:Env}):Promise<Response>{
 const denied=await requireAdmin(request,env);if(denied)return denied;
 if(!env.DB||!env.TMDB_READ_ACCESS_TOKEN)return json({error:"Base D1 ou jeton TMDB indisponible."},503);
 let body:unknown;try{body=await request.json();}catch{return json({error:"Requête invalide."},400);}
 if(!isObj(body)||typeof body.fileCode!=="string"||typeof body.tmdbId!=="number"||(body.kind!=="movie"&&body.kind!=="series"))return json({error:"Sélection TMDB invalide."},400);
 const code=body.fileCode.trim(),tmdbId=body.tmdbId,kind=body.kind;
 if(!/^[A-Za-z0-9]{6,64}$/.test(code)||!Number.isSafeInteger(tmdbId)||tmdbId<=0)return json({error:"Code Uqload ou identifiant TMDB invalide."},400);
 const files=await env.DB.prepare("SELECT id FROM catalog_media_sources WHERE provider='uqload' AND file_code=?").bind(code).all<{id:string}>();
 
 const detail=await tmdb(kind==="series"?`/tv/${tmdbId}`:`/movie/${tmdbId}`,env.TMDB_READ_ACCESS_TOKEN);
 const title=clean(detail.title||detail.name,300);if(!title)return json({error:"Titre absent de la fiche TMDB."},502);
 const fileTitle=clean(body.fileTitle,300);
 const marker=fileTitle.match(/(?:^|[^A-Za-z0-9])S([0-9OQIl]{1,2})[._ -]*E([0-9OQIl]{1,3})(?:[^0-9]|$)/i);
 const digits=(value:string)=>value.replace(/[OQ]/gi,"0").replace(/[Il]/g,"1");
 const parsedSeason=marker?Number(digits(marker[1])):NaN;
 const parsedEpisode=marker?Number(digits(marker[2])):NaN;
 const seasonNumber=Number.isInteger(body.season)&&Number(body.season)>=0?Number(body.season):parsedSeason;
 const episodeNumber=Number.isInteger(body.episode)&&Number(body.episode)>0?Number(body.episode):parsedEpisode;
 const id=`tmdb:${kind}:${tmdbId}`;
 const genres=Array.isArray(detail.genres)?detail.genres.filter(isObj).map(g=>clean(g.name,80)).filter(Boolean):[];
 const releaseDate=clean(detail.release_date||detail.first_air_date,20)||null;
 const metadata=JSON.stringify({tmdbId,originalTitle:clean(detail.original_title||detail.original_name),manualTmdbSelection:true});
 await env.DB.prepare(`INSERT INTO catalog_titles (id,kind,title,overview,release_date,poster_path,backdrop_path,genres_json,metadata_json,published,updated_at)
 VALUES (?,?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP)
 ON CONFLICT(id) DO UPDATE SET title=excluded.title,overview=excluded.overview,release_date=excluded.release_date,
 poster_path=COALESCE(catalog_titles.poster_path,excluded.poster_path),backdrop_path=COALESCE(catalog_titles.backdrop_path,excluded.backdrop_path),
 genres_json=excluded.genres_json,metadata_json=json_patch(CASE WHEN json_valid(catalog_titles.metadata_json) THEN catalog_titles.metadata_json ELSE '{}' END,excluded.metadata_json),updated_at=CURRENT_TIMESTAMP`)
 .bind(id,kind,title,clean(detail.overview),releaseDate,clean(detail.poster_path,180)||null,clean(detail.backdrop_path,180)||null,JSON.stringify(genres),metadata).run();
 let episodeId:string|null=null;
 if(kind==="series"){
  const season=Number(body.season),episode=Number(body.episode);
  if(Number.isInteger(season)&&season>=0&&Number.isInteger(episode)&&episode>0){
   const seasonData=await tmdb(`/tv/${tmdbId}/season/${season}`,env.TMDB_READ_ACCESS_TOKEN).catch(()=>({} as Obj));
   const list=Array.isArray(seasonData.episodes)?seasonData.episodes.filter(isObj):[];
   const ep=list.find(x=>Number(x.episode_number)===episode);
   episodeId=`${id}:s${season}:e${episode}`;
   await env.DB.prepare(`INSERT INTO catalog_episodes (id,title_id,season_number,episode_number,title,overview,duration_seconds,thumbnail_path,metadata_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET title=excluded.title,overview=excluded.overview,duration_seconds=excluded.duration_seconds,thumbnail_path=excluded.thumbnail_path,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP`)
    .bind(episodeId,id,season,episode,clean(ep?.name)||`Épisode ${episode}`,clean(ep?.overview,8000),Number.isFinite(Number(ep?.runtime))?Number(ep?.runtime)*60:null,clean(ep?.still_path,180)||null,JSON.stringify({tmdbId:ep?.id??null,airDate:clean(ep?.air_date,20)})).run();
  }
 }
 await env.DB.prepare(`INSERT INTO catalog_media_sources (id,title_id,episode_id,provider,file_code,video_id,playback_url,quality,encoding_status,uploaded_at,updated_at)
 VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider,file_code) DO NOTHING`)
 .bind(crypto.randomUUID(),id,episodeId,"uqload",code,code,`https://uqload.vc/embed-${code}.html`,null,"ready",null).run();
 return json({associated:true,title,kind,titleId:id,episodeId,published:false,episodeDetected:Boolean(episodeId)});
}