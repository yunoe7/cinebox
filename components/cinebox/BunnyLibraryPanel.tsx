"use client";
import { useCallback, useEffect, useState } from "react";
import { Film, LoaderCircle, Play, RefreshCw, Upload, Video } from "lucide-react";
type BunnyVideo={id:string;title:string;durationSeconds:number|null;thumbnailUrl:string|null};
type BunnyList={libraryId:string;total:number;videos:BunnyVideo[]};
type CatalogItem={id:string;title:string;kind:string};
type Ticket={libraryId:string;videoId:string;endpoint:string;signature:string;expires:number;title:string};
const b64=(s:string)=>{const bytes=new TextEncoder().encode(s);let out="";bytes.forEach(x=>out+=String.fromCharCode(x));return btoa(out);};
async function tusUpload(file:File,t:Ticket,progress:(n:number)=>void){
 const headers={"AuthorizationSignature":t.signature,"AuthorizationExpire":String(t.expires),"LibraryId":t.libraryId,"VideoId":t.videoId,"Tus-Resumable":"1.0.0","Upload-Length":String(file.size),"Upload-Metadata":"filetype "+b64(file.type||"application/octet-stream")+",title "+b64(t.title)};
 const init=await fetch(t.endpoint,{method:"POST",headers});
 if(!init.ok)throw new Error("Bunny a refusé de démarrer l'envoi TUS.");
 const location=init.headers.get("Location");if(!location)throw new Error("Adresse de transfert absente dans la réponse Bunny.");
 const url=new URL(location,t.endpoint).toString();let offset=Number(init.headers.get("Upload-Offset")||0);const chunk=8*1024*1024;
 while(offset<file.size){const end=Math.min(offset+chunk,file.size);const r=await fetch(url,{method:"PATCH",headers:{"AuthorizationSignature":t.signature,"AuthorizationExpire":String(t.expires),"LibraryId":t.libraryId,"VideoId":t.videoId,"Tus-Resumable":"1.0.0","Upload-Offset":String(offset),"Content-Type":"application/offset+octet-stream"},body:file.slice(offset,end)});if(!r.ok)throw new Error("L'envoi a été interrompu. Vérifie ta connexion puis relance l'import.");const next=Number(r.headers.get("Upload-Offset")||end);if(next<=offset)throw new Error("Bunny n'a pas confirmé la progression.");offset=next;progress(Math.round(offset/file.size*100));}
}
export function BunnyLibraryPanel(){
 const [data,setData]=useState<BunnyList|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[playing,setPlaying]=useState<BunnyVideo|null>(null);
 const [catalog,setCatalog]=useState<CatalogItem[]>([]),[token,setToken]=useState(""),[titleId,setTitleId]=useState(""),[file,setFile]=useState<File|null>(null),[progress,setProgress]=useState(0),[uploading,setUploading]=useState(false),[message,setMessage]=useState("");
 const refresh=useCallback(async()=>{setLoading(true);setError("");try{const r=await fetch("/api/bunny/videos",{cache:"no-store"});const p=await r.json() as BunnyList|{error?:string};if(!r.ok||!("videos" in p))throw new Error("error" in p&&p.error?p.error:"Bibliothèque Bunny indisponible.");setData(p);}catch(e){setError(e instanceof Error?e.message:"Erreur inconnue.");}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();void fetch("/api/catalog?limit=50").then(r=>r.ok?r.json():null).then(p=>{if(p&&Array.isArray(p.titles))setCatalog(p.titles);}).catch(()=>{});},[refresh]);
 const upload=async()=>{if(!file||!titleId||token.length<32)return;setUploading(true);setProgress(0);setMessage("");try{
  const tr=await fetch("/api/bunny/upload-ticket",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({title:catalog.find(x=>x.id===titleId)?.title||file.name,fileName:file.name,fileSize:file.size,titleId})});
  const t=await tr.json() as Ticket|{error?:string};if(!tr.ok||!("videoId" in t))throw new Error("error" in t&&t.error?t.error:"Préparation de l'envoi impossible.");
  await tusUpload(file,t,setProgress);
  const cr=await fetch("/api/bunny/upload-complete",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({videoId:t.videoId,titleId})});
  const done=await cr.json() as {error?:string;linked?:boolean};if(!cr.ok||!done.linked)throw new Error(done.error||"Vidéo envoyée mais association impossible.");
  setMessage("Vidéo envoyée et associée au titre partagé.");setFile(null);await refresh();
 }catch(e){setMessage(e instanceof Error?e.message:"L'envoi a échoué.");}finally{setUploading(false);}};
 return <section className="admin-panel" aria-labelledby="bunny-library-title" style={{marginTop:24,padding:22}}>
 <div className="admin-panel-heading" style={{alignItems:"center"}}><div><span className="eyebrow">STOCKAGE VIDÉO CONNECTÉ</span><h3 id="bunny-library-title"><Video size={17} style={{verticalAlign:"middle",marginRight:8}}/>Bunny Stream · CinéBox</h3></div><button type="button" className="admin-media-edit" onClick={()=>void refresh()} disabled={loading}>{loading?<LoaderCircle size={14}/>:<RefreshCw size={14}/>} Actualiser</button></div>
 <p className="subtle" style={{margin:"8px 0 16px",lineHeight:1.6}}>Les vidéos sont envoyées directement à Bunny. La clé API Bunny reste côté serveur.</p>
 {loading&&!data?<p className="subtle">Chargement…</p>:null}{error?<p role="alert" className="subtle">{error}</p>:null}
 {data&&<><div className="admin-media-summary" style={{marginBottom:16}}><div><Film size={17}/><span><strong>{data.total}</strong> vidéo(s) dans Bunny Stream</span></div><div><span className="subtle">Bibliothèque</span><strong>{data.libraryId}</strong></div></div>
 <div style={{border:"1px solid rgba(220,195,146,.2)",borderRadius:10,padding:16,marginBottom:18}}>
 <strong style={{display:"flex",alignItems:"center",gap:8}}><Upload size={16}/> Importer une vidéo dans CinéBox</strong><p className="subtle" style={{margin:"8px 0 14px"}}>Sélectionne une fiche publiée dans le catalogue partagé puis le fichier vidéo.</p>
 <label htmlFor="bunny-admin-token" className="subtle">Code administrateur temporaire</label><input id="bunny-admin-token" type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder="Secret configuré dans Cloudflare Preview" style={{width:"100%",margin:"6px 0 12px"}}/>
 <label htmlFor="bunny-title-select" className="subtle">Titre du catalogue</label><select id="bunny-title-select" value={titleId} onChange={e=>setTitleId(e.target.value)} style={{width:"100%",margin:"6px 0 12px"}}><option value="">Choisir un titre publié…</option>{catalog.map(x=><option key={x.id} value={x.id}>{x.title} · {x.kind}</option>)}</select>
 <label htmlFor="bunny-video-file" className="subtle">Fichier vidéo (5 Go maximum)</label><input id="bunny-video-file" type="file" accept="video/*,.mkv,.avi,.mov" disabled={uploading} onChange={e=>setFile(e.target.files?.[0]||null)} style={{display:"block",width:"100%",margin:"6px 0 12px"}}/>
 {uploading?<div style={{height:8,background:"rgba(255,255,255,.1)",borderRadius:99,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:progress+"%",background:"#d8b978"}}/></div>:null}{message?<p role="status" className="subtle">{message}</p>:null}
 <button type="button" className="admin-media-edit" disabled={uploading||!file||!titleId||token.length<32} onClick={()=>void upload()}>{uploading?<><LoaderCircle size={14}/> Envoi {progress}%</>:<><Upload size={14}/> Envoyer vers Bunny et associer</>}</button>
 </div>
 {data.videos.length?<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:14}}>{data.videos.map(v=><article key={v.id} style={{overflow:"hidden",border:"1px solid rgba(220,195,146,.14)",borderRadius:9}}><div style={{aspectRatio:"16/9",background:"#090a0c"}}>{v.thumbnailUrl?<img src={v.thumbnailUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<Video/>}</div><div style={{padding:12}}><strong>{v.title}</strong><button type="button" className="admin-media-edit" onClick={()=>setPlaying(v)}><Play size={13}/> Prévisualiser</button></div></article>)}</div>:<div className="admin-empty-panel"><Video size={24}/><strong>Aucune vidéo dans Bunny Stream</strong><span>Les vidéos importées apparaîtront ici.</span></div>}
 {playing&&<div role="dialog" aria-modal="true" style={{position:"fixed",inset:0,zIndex:100,display:"grid",placeItems:"center",padding:20,background:"rgba(0,0,0,.88)"}} onClick={e=>{if(e.target===e.currentTarget)setPlaying(null);}}><div style={{width:"min(100%,1050px)",background:"#111"}}><div style={{display:"flex",justifyContent:"space-between",padding:12}}><strong>{playing.title}</strong><button type="button" onClick={()=>setPlaying(null)}>Fermer</button></div><div style={{aspectRatio:"16/9"}}><iframe title={"Lecture "+playing.title} src={"https://iframe.mediadelivery.net/embed/"+data.libraryId+"/"+playing.id} allowFullScreen style={{width:"100%",height:"100%",border:0}}/></div></div></div>}
 </>}
 </section>;
}
