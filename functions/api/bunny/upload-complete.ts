interface Env {
  BUNNY_STREAM_API_KEY?: string;
  BUNNY_STREAM_LIBRARY_ID?: string;
  CINEBOX_ADMIN_TOKEN?: string;
  DB?: { prepare(sql: string): { bind(...v: (string|number)[]): { run(): Promise<{success:boolean}> } } };
}
function json(body: unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function authorized(request:Request,env:Env){const e=env.CINEBOX_ADMIN_TOKEN||"",s=(request.headers.get("authorization")||"").replace(/^Bearer /,"");if(e.length<32||s.length!==e.length)return false;let d=0;for(let i=0;i<e.length;i++)d|=e.charCodeAt(i)^s.charCodeAt(i);return d===0;}
export async function onRequestPost({request,env}:{request:Request;env:Env}):Promise<Response>{
 if(!authorized(request,env))return json({error:"Authentification administrateur requise."},401);
 if(!env.DB||!env.BUNNY_STREAM_API_KEY||!env.BUNNY_STREAM_LIBRARY_ID)return json({error:"Configuration incomplète."},503);
 let b:any;try{b=await request.json()}catch{return json({error:"Requête invalide."},400)}
 const videoId=typeof b?.videoId==="string"?b.videoId:"",titleId=typeof b?.titleId==="string"?b.titleId:"";
 if(!/^[a-f0-9-]{20,64}$/i.test(videoId)||!/^(?:tmdb:(movie|series):[0-9]+|cinebox:[0-9]{1,20})$/.test(titleId))return json({error:"Identifiants invalides."},400);
 try{
  const check=await fetch(`https://video.bunnycdn.com/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`,{headers:{AccessKey:env.BUNNY_STREAM_API_KEY,Accept:"application/json"}});
  if(!check.ok)return json({error:"La vidéo n'est pas encore visible dans Bunny."},409);
  const info=await check.json() as {status?:number};
  const r=await env.DB.prepare("UPDATE catalog_titles SET metadata_json = json_set(metadata_json, '$.bunnyVideoId', ?, '$.bunnyStatus', ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND published = 1").bind(videoId,info.status??0,titleId).run();
  if(!r.success)return json({error:"Impossible d'associer la vidéo au catalogue."},503);
  return json({linked:true,videoId,titleId,status:info.status??0});
 }catch{return json({error:"Impossible de vérifier la vidéo auprès de Bunny."},503)}
}
