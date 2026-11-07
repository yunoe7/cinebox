interface Env {
  BUNNY_STREAM_API_KEY?: string;
  BUNNY_STREAM_LIBRARY_ID?: string;
  CINEBOX_ADMIN_TOKEN?: string;
  DB?: { prepare(sql: string): { bind(...v: (string|number)[]): { first<T>(): Promise<T|null> } } };
}
function json(body: unknown, status=200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "x-content-type-options":"nosniff" } });
}
function authorized(request: Request, env: Env): boolean {
  const expected=env.CINEBOX_ADMIN_TOKEN||"";
  const supplied=(request.headers.get("authorization")||"").replace(/^Bearer /,"");
  if(expected.length<32 || supplied.length!==expected.length) return false;
  let diff=0; for(let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i)^supplied.charCodeAt(i);
  return diff===0;
}
async function sha256Hex(value: string): Promise<string> {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function onRequestPost({request,env}:{request:Request;env:Env}):Promise<Response> {
  if(!authorized(request,env)) return json({error:"Secret administrateur incorrect ou non configuré."},401);
  if(!env.BUNNY_STREAM_API_KEY || !env.BUNNY_STREAM_LIBRARY_ID) return json({error:"Bunny Stream n'est pas configuré."},503);
  let body: any; try { body=await request.json(); } catch { return json({error:"Requête invalide."},400); }
  const title=typeof body?.title==="string"?body.title.trim().slice(0,300):"";
  const fileSize=Number(body?.fileSize);
  const fileName=typeof body?.fileName==="string"?body.fileName.slice(0,240):"video";
  const titleId=typeof body?.titleId==="string"?body.titleId.slice(0,160):"";
  if(!title || !Number.isSafeInteger(fileSize) || fileSize<1 || fileSize>5*1024*1024*1024) return json({error:"Titre ou taille de fichier invalide (maximum 5 Go pour cette première version)."},400);
  if(titleId) {
    if(!env.DB) return json({error:"Catalogue distant indisponible."},503);
    const found=await env.DB.prepare("SELECT id FROM catalog_titles WHERE id = ? AND published = 1").bind(titleId).first<{id:string}>();
    if(!found) return json({error:"Le titre doit d'abord être publié dans le catalogue partagé."},404);
  }
  try {
    const created=await fetch(`https://video.bunnycdn.com/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos`,{
      method:"POST",headers:{AccessKey:env.BUNNY_STREAM_API_KEY,Accept:"application/json","Content-Type":"application/json"},
      body:JSON.stringify({title})
    });
    if(!created.ok) return json({error:"Bunny n'a pas pu créer la vidéo."},502);
    const video=await created.json() as {guid?:string};
    if(!video.guid) return json({error:"Bunny n'a pas retourné d'identifiant vidéo."},502);
    const expires=Math.floor(Date.now()/1000)+6*60*60;
    const signature=await sha256Hex(env.BUNNY_STREAM_LIBRARY_ID+env.BUNNY_STREAM_API_KEY+expires+video.guid);
    return json({libraryId:env.BUNNY_STREAM_LIBRARY_ID,videoId:video.guid,endpoint:"https://video.bunnycdn.com/tusupload",signature,expires,title,fileName});
  } catch { return json({error:"Impossible de joindre Bunny Stream."},503); }
}
