"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Check, ChevronRight, LoaderCircle, LogOut, Play, RefreshCw, Search, ShieldCheck, Star, Video, X } from "lucide-react";
import { adminJson, getAdminSession, isAdminAuthError, loginAdmin, logoutAdmin } from "../../lib/cinebox/admin-session.mjs";

type BunnyVideo = { id: string; title: string; durationSeconds: number | null; thumbnailUrl: string | null; status?: number | null };
type BunnyList = { libraryId: string; total: number; videos: BunnyVideo[] };
type TmdbHit = { id: number; media_type?: string; title?: string; name?: string; release_date?: string; first_air_date?: string; poster_path?: string | null; overview?: string; vote_average?: number };
type TmdbDetail = TmdbHit & { genres?: Array<{id:number;name:string}>; backdrop_path?:string|null; runtime?:number|null; number_of_seasons?:number; seasons?:Array<{season_number:number;name:string;episode_count:number;air_date?:string}>; credits?:{cast?:Array<{name:string;character:string}>;crew?:Array<{name:string;job:string}>}; vote_count?:number; original_language?:string };
type TmdbEpisode = { episode_number:number; name:string; overview:string; air_date?:string; runtime?:number|null; still_path?:string|null; id:number };
type TmdbSeason = { episodes: TmdbEpisode[]; name:string; overview?:string; season_number:number; air_date?:string };
type Review = { author:string; content:string; author_details?:{rating?:number|null}; created_at?:string };
type ReviewPayload = { results?:Review[] };
const image = (path?:string|null, size="w500") => path ? `https://image.tmdb.org/t/p/${size}${path}` : "";
const inputStyle:CSSProperties={width:"100%",minHeight:42,borderRadius:9,padding:"0 12px",border:"1px solid rgba(220,195,146,.2)",background:"#0b0c0f",color:"#f5f1e9",font:"inherit",fontSize:12,outline:"none"};
const buttonStyle:CSSProperties={border:"1px solid rgba(213,180,122,.3)",borderRadius:9,padding:"9px 13px",color:"#d9bb82",background:"rgba(213,180,122,.08)",fontSize:11,cursor:"pointer"};

function cleanSearchName(value:string) {
  return value.replace(/\\.[^.]+$/,"").replace(/[._]+/g," ").replace(/\bS\d{1,2}E\d{1,3}\b/i," ").replace(/\b(1080p|720p|2160p|WEB[- ]?DL|BluRay|VOSTFR|MULTI|HDTV)\b/gi," ").replace(/\[[^\]]*\]|\([^)]*\)/g," ").replace(/\s+/g," ").trim();
}
function episodeHint(value:string) {
  const match=value.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
  return match ? {season:Number(match[1]),episode:Number(match[2])}:null;
}

export function BunnyLibraryPanel() {
  const [data,setData]=useState<BunnyList|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [authState,setAuthState]=useState<"checking"|"anonymous"|"authenticated">("checking");
  const [password,setPassword]=useState("");
  const [loggingIn,setLoggingIn]=useState(false);
  const [selectedVideo,setSelectedVideo]=useState<BunnyVideo|null>(null);
  const [query,setQuery]=useState("");
  const [hits,setHits]=useState<TmdbHit[]>([]);
  const [searching,setSearching]=useState(false);
  const [detail,setDetail]=useState<TmdbDetail|null>(null);
  const [mediaType,setMediaType]=useState<"movie"|"tv">("movie");
  const [reviews,setReviews]=useState<Review[]>([]);
  const [seasonNumber,setSeasonNumber]=useState(1);
  const [season,setSeason]=useState<TmdbSeason|null>(null);
  const [episodeNumber,setEpisodeNumber]=useState(1);
  const [loadingSeason,setLoadingSeason]=useState(false);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [preview,setPreview]=useState<BunnyVideo|null>(null);

  const refresh=useCallback(async()=>{
    if(authState!=="authenticated"){setData(null);setError("Connecte-toi comme administrateur pour charger la bibliothèque Bunny.");setLoading(false);return;}
    setLoading(true);setError("");
    try{
      const payload=await adminJson("/api/bunny/videos") as BunnyList|{error?:string};
      if(!("videos" in payload))throw new Error("error" in payload&&payload.error?payload.error:"Bibliothèque Bunny indisponible.");
      setData(payload);
    }catch(e){
      if(isAdminAuthError(e)&&e.status===401)setAuthState("anonymous");
      setError(e instanceof Error?e.message:"Erreur de connexion.");
    }
    finally{setLoading(false);}
  },[authState]);
  useEffect(()=>{let cancelled=false;void getAdminSession().then(session=>{if(!cancelled)setAuthState(session.authenticated?"authenticated":"anonymous");});return()=>{cancelled=true;};},[]);
  useEffect(()=>{if(authState==="authenticated")void refresh();},[authState,refresh]);
  const logout=async()=>{await logoutAdmin();setAuthState("anonymous");setPassword("");setData(null);setSelectedVideo(null);setDetail(null);setHits([]);setReviews([]);setSeason(null);setPreview(null);setMessage("");setError("");};
  const login=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(loggingIn||password.length===0)return;
    setLoggingIn(true);setError("");setMessage("");
    try{await loginAdmin(password);setPassword("");setAuthState("authenticated");}
    catch(e){setError(e instanceof Error?e.message:"Connexion administrateur impossible.");}
    finally{setLoggingIn(false);}
  };

  const selectVideo=async(video:BunnyVideo)=>{
    setSelectedVideo(video);setPreview(null);setDetail(null);setHits([]);setReviews([]);setSeason(null);setMessage("");
    const hint=episodeHint(video.title);
    setSeasonNumber(hint?.season??1);setEpisodeNumber(hint?.episode??1);
    const next=cleanSearchName(video.title);setQuery(next);
    if(!next)return;
    setSearching(true);
    try{
      const response=await fetch("/api/tmdb/search?query="+encodeURIComponent(next)+"&kind=multi");
      const payload=await response.json() as {results?:TmdbHit[];error?:string};
      if(!response.ok)throw new Error(payload.error||"Recherche TMDB impossible.");
      setHits((payload.results||[]).filter(item=>item.media_type==="movie"||item.media_type==="tv").slice(0,8));
    }catch(e){setMessage(e instanceof Error?e.message:"Recherche TMDB impossible.");}
    finally{setSearching(false);}
  };

  const chooseHit=async(hit:TmdbHit)=>{
    const type=hit.media_type==="tv"?"tv":"movie";setMediaType(type);setDetail(null);setReviews([]);setSeason(null);
    setSearching(true);setMessage("");
    try{
      const [d,r]=await Promise.all([
        fetch(`/api/tmdb/${type}/${hit.id}`).then(x=>x.json()),
        fetch(`/api/tmdb/${type}/${hit.id}/reviews`).then(x=>x.json())
      ]);
      if(d.error)throw new Error(d.error);
      setDetail(d as TmdbDetail);setReviews((r as ReviewPayload).results||[]);
      if(type==="tv"){
        const hinted=episodeHint(selectedVideo?.title||"");
        const available=(d as TmdbDetail).seasons||[];
        const initial=available.some(s=>s.season_number===(hinted?.season??1))?(hinted?.season??1):(available.find(s=>s.season_number>0)?.season_number??0);
        setSeasonNumber(initial);
        await loadSeason(hit.id,initial);
        if(hinted)setEpisodeNumber(hinted.episode);
      }
    }catch(e){setMessage(e instanceof Error?e.message:"Chargement TMDB impossible.");}
    finally{setSearching(false);}
  };

  const loadSeason=async(tmdbId:number,number:number)=>{
    setLoadingSeason(true);
    try{
      const response=await fetch(`/api/tmdb/tv/${tmdbId}/season/${number}`);
      const payload=await response.json() as TmdbSeason&{error?:string};
      if(!response.ok)throw new Error(payload.error||"Impossible de charger les épisodes.");
      setSeason(payload);
      if(!payload.episodes?.some(e=>e.episode_number===episodeNumber))setEpisodeNumber(payload.episodes?.[0]?.episode_number??1);
    }catch(e){setMessage(e instanceof Error?e.message:"Chargement des épisodes impossible.");}
    finally{setLoadingSeason(false);}
  };

  const publish=async()=>{
    if(!selectedVideo||!detail||authState!=="authenticated")return;
    if(mediaType==="tv"&&(!season||!season.episodes.some(e=>e.episode_number===episodeNumber))){setMessage("Choisis un épisode valide.");return;}
    setSaving(true);setMessage("");
    try{
      const selectedSeason=season;
      const selectedEpisode=selectedSeason?.episodes.find(e=>e.episode_number===episodeNumber);
      const payload={
        tmdbId:detail.id,kind:mediaType==="tv"?"series":"movie",
        title:detail.title||detail.name||"Sans titre",
        overview:detail.overview||"",
        releaseDate:detail.release_date||detail.first_air_date||"",
        posterPath:detail.poster_path||null,backdropPath:detail.backdrop_path||null,
        genres:(detail.genres||[]).map(g=>g.name),
        metadata:{
          voteAverage:detail.vote_average??null,voteCount:detail.vote_count??null,
          runtime:detail.runtime??null,originalLanguage:detail.original_language??null,
          cast:(detail.credits?.cast||[]).slice(0,20).map(c=>({name:c.name,character:c.character})),
          directors:(detail.credits?.crew||[]).filter(c=>c.job==="Director").map(c=>c.name).slice(0,5),
          tmdbReviews:reviews.slice(0,10).map(r=>({author:r.author,content:r.content.slice(0,3000),rating:r.author_details?.rating??null,createdAt:r.created_at??null})),
          bunnyVideoId:mediaType==="movie"?selectedVideo.id:undefined
        },
        bunnyVideoId:selectedVideo.id,
        ...(mediaType==="tv"&&selectedEpisode&&selectedSeason?{
          targetEpisode:{seasonNumber,episodeNumber},
          seasons:[{number:seasonNumber,name:selectedSeason.name,overview:selectedSeason.overview,airDate:selectedSeason.air_date,episodes:selectedSeason.episodes.map(e=>({
            number:e.episode_number,title:e.name,overview:e.overview,airDate:e.air_date,runtime:e.runtime??undefined,tmdbId:e.id,thumbnailPath:e.still_path||null
          }))}]
        }:{})
      };
      const result=await adminJson("/api/catalog/publish",{method:"POST",body:JSON.stringify(payload)}) as {error?:string;published?:boolean};
      if(!result.published)throw new Error(result.error||"Publication impossible.");
      setMessage(mediaType==="tv"?"Épisode associé et fiche série publiée dans CinéBox.":"Film publié avec sa vidéo Bunny.");
      await refresh();
    }catch(e){
      if(isAdminAuthError(e)&&e.status===401)setAuthState("anonymous");
      setMessage(e instanceof Error?e.message:"Publication impossible.");
    }
    finally{setSaving(false);}
  };

  const label:CSSProperties={display:"block",fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#b6b0a4",marginBottom:7};
  return <section aria-label="Bibliothèque Bunny Stream" style={{marginTop:24,padding:20,border:"1px solid rgba(220,195,146,.18)",borderRadius:16,background:"linear-gradient(145deg,rgba(24,23,21,.98),rgba(13,14,17,.98))"}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:18}}>
      <div><h3 style={{margin:0,color:"#f4f0e8",fontSize:17}}>Bibliothèque Bunny</h3><p style={{margin:"5px 0 0",fontSize:11,color:"#888b92"}}>{data?.total??0} vidéo(s) hébergée(s) · sélectionne une vidéo pour créer sa fiche</p></div>
      <button type="button" onClick={()=>void refresh()} disabled={loading||authState!=="authenticated"} style={buttonStyle}>{loading?<LoaderCircle size={13}/>:<RefreshCw size={13}/>} Actualiser</button>
    </header>
    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
      {authState==="authenticated"?(
        <>
          <span style={{display:"flex",alignItems:"center",gap:6,color:"#888b92",fontSize:9}}><ShieldCheck size={12}/> Session administrateur active</span>
          <button type="button" onClick={()=>void logout()} style={buttonStyle} title="Fermer la session administrateur"><LogOut size={13}/> Déconnexion</button>
        </>
      ):authState==="anonymous"?(
        <form onSubmit={login} style={{display:"flex",gap:8,alignItems:"center",flex:"1 1 360px",flexWrap:"wrap"}}>
          <input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mot de passe administrateur" aria-label="Mot de passe administrateur" disabled={loggingIn} style={{...inputStyle,flex:"1 1 260px"}}/>
          <button type="submit" disabled={loggingIn||password.length===0} style={buttonStyle}>{loggingIn?<LoaderCircle size={13}/>:<ShieldCheck size={13}/>} Se connecter</button>
        </form>
      ):(
        <span style={{display:"flex",alignItems:"center",gap:6,color:"#888b92",fontSize:9}}><LoaderCircle size={12} className="animate-spin"/> Vérification de la session…</span>
      )}
    </div>
    {error&&<p role="alert" style={{color:"#ffaaa0",fontSize:12}}>{error}</p>}
    <div style={{display:"grid",gridTemplateColumns:"minmax(250px,.85fr) minmax(300px,1.15fr)",gap:18}}>
      <div style={{display:"grid",alignContent:"start",gap:8,maxHeight:620,overflowY:"auto",paddingRight:4}}>
        {loading&&!data?<LoaderCircle className="animate-spin"/>:data?.videos.map(video=><button key={video.id} type="button" onClick={()=>void selectVideo(video)} style={{display:"flex",alignItems:"center",gap:10,textAlign:"left",padding:9,borderRadius:10,border:selectedVideo?.id===video.id?"1px solid rgba(213,180,122,.65)":"1px solid rgba(255,255,255,.08)",background:selectedVideo?.id===video.id?"rgba(213,180,122,.10)":"rgba(255,255,255,.025)",cursor:"pointer",color:"#eee"}}>
          {video.thumbnailUrl?<img src={video.thumbnailUrl} alt="" style={{width:82,aspectRatio:"16/9",objectFit:"cover",borderRadius:6,background:"#08090b"}}/>:<span style={{width:82,aspectRatio:"16/9",display:"grid",placeItems:"center",background:"#08090b",borderRadius:6,color:"#c5a56d"}}><Video size={18}/></span>}
          <span style={{minWidth:0,flex:1}}><strong style={{display:"block",fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{video.title}</strong><small style={{color:"#85878e",fontSize:9}}>{video.durationSeconds?Math.round(video.durationSeconds/60)+" min":"Durée en traitement"}</small></span>
          <ChevronRight size={15} color="#c5a56d"/>
        </button>)}
        {!loading&&data?.videos.length===0&&<p style={{color:"#999",fontSize:12}}>Aucune vidéo dans Bunny pour le moment.</p>}
      </div>
      <div style={{minWidth:0,padding:16,borderRadius:12,border:"1px solid rgba(255,255,255,.08)",background:"rgba(0,0,0,.15)"}}>
        {!selectedVideo?<div style={{minHeight:300,display:"grid",placeItems:"center",textAlign:"center",color:"#85878e",fontSize:12}}><div><Video size={30}/><p>Choisis une vidéo Bunny pour commencer.</p></div></div>:<>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14}}><div><strong style={{fontSize:12,color:"#f3eee4"}}>{selectedVideo.title}</strong><p style={{margin:"4px 0 0",fontSize:9,color:"#85878e"}}>Fichier déjà hébergé · aucun nouvel envoi</p></div><button type="button" onClick={()=>setPreview(selectedVideo)} style={buttonStyle}><Play size={13}/> Aperçu</button></div>
          <label style={label}>Recherche TMDB</label>
          <div style={{display:"flex",gap:7}}><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void (async()=>{setSearching(true);try{const r=await fetch("/api/tmdb/search?query="+encodeURIComponent(query)+"&kind=multi");const j=await r.json();setHits((j.results||[]).filter((x:TmdbHit)=>x.media_type==="movie"||x.media_type==="tv"));}finally{setSearching(false);}})();}} style={{...inputStyle,flex:1}}/><button type="button" disabled={searching||!query.trim()} onClick={async()=>{setSearching(true);try{const r=await fetch("/api/tmdb/search?query="+encodeURIComponent(query)+"&kind=multi");const j=await r.json();setHits((j.results||[]).filter((x:TmdbHit)=>x.media_type==="movie"||x.media_type==="tv"));}catch{setMessage("Recherche TMDB impossible.");}finally{setSearching(false);}}} style={buttonStyle}>{searching?<LoaderCircle size={14}/>:<Search size={14}/>}</button></div>
          {hits.length>0&&!detail&&<div style={{display:"grid",gap:6,maxHeight:230,overflowY:"auto",marginTop:10}}>{hits.map(hit=><button key={hit.id+"-"+hit.media_type} type="button" onClick={()=>void chooseHit(hit)} style={{display:"flex",alignItems:"center",gap:9,textAlign:"left",padding:7,borderRadius:8,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.03)",color:"#eee",cursor:"pointer"}}>{hit.poster_path?<img src={image(hit.poster_path,"w92")} alt="" style={{width:38,height:55,objectFit:"cover",borderRadius:4}}/>:<span style={{width:38,height:55,background:"#222"}}/>}<span style={{flex:1,minWidth:0}}><strong style={{display:"block",fontSize:11}}>{hit.title||hit.name}</strong><small style={{color:"#888",fontSize:9}}>{hit.media_type==="tv"?"Série":"Film"} · {(hit.release_date||hit.first_air_date||"").slice(0,4)} · TMDB {hit.vote_average?.toFixed(1)||"—"}</small></span><ChevronRight size={14}/></button>)}</div>}
          {detail&&<div style={{marginTop:14}}>
            <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>{detail.poster_path&&<img src={image(detail.poster_path)} alt="" style={{width:92,borderRadius:8,objectFit:"cover"}}/>}<div style={{minWidth:0}}><strong style={{fontSize:15,color:"#f4f0e8"}}>{detail.title||detail.name}</strong><p style={{fontSize:10,color:"#aaa",lineHeight:1.5,margin:"5px 0"}}>{detail.overview||"Synopsis indisponible."}</p><small style={{color:"#d9bb82",display:"inline-flex",alignItems:"center",gap:4}}><Star size={11} aria-hidden="true"/> {detail.vote_average?.toFixed(1)||"—"} · {detail.vote_count??0} votes · {(detail.release_date||detail.first_air_date||"").slice(0,4)}</small><p style={{fontSize:9,color:"#888",margin:"5px 0"}}>{(detail.genres||[]).map(g=>g.name).join(" · ")}</p></div></div>
            {mediaType==="tv"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:14}}><div><label style={label}>Saison</label><select value={seasonNumber} onChange={e=>{const n=Number(e.target.value);setSeasonNumber(n);void loadSeason(detail.id,n);}} style={inputStyle}>{(detail.seasons||[]).map(s=><option key={s.season_number} value={s.season_number}>{s.name||"Saison "+s.season_number}</option>)}</select></div><div><label style={label}>Épisode</label><select value={episodeNumber} onChange={e=>setEpisodeNumber(Number(e.target.value))} style={inputStyle} disabled={loadingSeason||!season}>{(season?.episodes||[]).map(ep=><option key={ep.episode_number} value={ep.episode_number}>E{String(ep.episode_number).padStart(2,"0")} · {ep.name}</option>)}</select></div></div>}
            <div style={{marginTop:12,padding:10,borderRadius:8,background:"rgba(255,255,255,.03)"}}><strong style={{fontSize:10,color:"#d9bb82"}}>Casting et avis TMDB</strong><p style={{fontSize:9,color:"#aaa",margin:"5px 0"}}>{(detail.credits?.cast||[]).slice(0,6).map(c=>c.name).join(" · ")||"Casting non disponible"}</p><p style={{fontSize:9,color:"#888",margin:0}}>{reviews.length} avis TMDB récupérés · {(detail.credits?.crew||[]).find(c=>c.job==="Director")?.name||"Réalisation non renseignée"}</p></div>
            <button type="button" disabled={saving||authState!=="authenticated"||(mediaType==="tv"&&!season)} onClick={()=>void publish()} style={{...buttonStyle,width:"100%",marginTop:14,minHeight:42,background:"linear-gradient(110deg,#c6a36b,#e2c38b)",color:"#17130d",fontWeight:800,opacity:saving||authState!=="authenticated"?.55:1}}>{saving?<LoaderCircle size={15} className="animate-spin"/>:<Check size={15}/>} Publier la fiche et associer la vidéo</button>
          </div>}
          {message&&<p role="status" style={{padding:9,borderRadius:8,background:"rgba(115,153,112,.10)",color:"#b8d5ae",fontSize:10,lineHeight:1.5,marginTop:12}}>{message}</p>}
        </>}
      </div>
    </div>
    {preview&&data&&<div role="dialog" aria-modal="true" onClick={e=>{if(e.target===e.currentTarget)setPreview(null);}} style={{position:"fixed",inset:0,zIndex:100,display:"grid",placeItems:"center",padding:20,background:"rgba(0,0,0,.9)"}}><div style={{width:"min(100%,1000px)",background:"#101114",borderRadius:12,overflow:"hidden"}}><div style={{display:"flex",justifyContent:"space-between",padding:12,color:"#eee"}}><strong>{preview.title}</strong><button type="button" onClick={()=>setPreview(null)} style={buttonStyle}><X size={15}/></button></div><div style={{aspectRatio:"16/9"}}><iframe title={preview.title} src={`https://iframe.mediadelivery.net/embed/${data.libraryId}/${preview.id}`} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowFullScreen style={{width:"100%",height:"100%",border:0}}/></div></div></div>}
  </section>;
}
