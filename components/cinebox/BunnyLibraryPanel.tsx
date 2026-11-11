"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Check, ChevronRight, LoaderCircle, Play, RefreshCw, Search, Star, Video, X } from "lucide-react";
import { adminJson, getAdminSession, isAdminAuthError, loginAdmin, logoutAdmin } from "../../lib/cinebox/admin-session.mjs";
import { assessTmdbSeason, buildSeasonConfirmationMessage, buildSeasonPublishFragment, describeSeasonAssessment, planSeasonPublication, referenceEpisodeCountForSeason } from "../../lib/cinebox/tmdb-season.mjs";
import { AdminSessionPanel } from "./AdminSessionPanel";
import { useModalDialog } from "./useModalDialog";

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
  const previewCloseRef=useRef<HTMLButtonElement>(null);
  const { ref: previewDialogRef, dialogProps: previewDialogProps } = useModalDialog<HTMLDivElement>({
    active: Boolean(preview && data),
    onClose: () => setPreview(null),
    initialFocusRef: previewCloseRef,
  });

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
    // A stale season must never be publishable while another one is loading or
    // after a failed request: clear it before the fetch and on every error.
    setLoadingSeason(true);setSeason(null);setMessage("");
    try{
      const response=await fetch(`/api/tmdb/tv/${tmdbId}/season/${number}`);
      const payload=await response.json() as TmdbSeason&{error?:string};
      if(!response.ok)throw new Error(payload.error||"Impossible de charger les épisodes.");
      setSeason(payload);
      if(!payload.episodes?.some(e=>e.episode_number===episodeNumber))setEpisodeNumber(payload.episodes?.[0]?.episode_number??1);
    }catch(e){setSeason(null);setMessage(e instanceof Error?e.message:"Chargement des épisodes impossible.");}
    finally{setLoadingSeason(false);}
  };

  const publish=async()=>{
    if(!selectedVideo||!detail||authState!=="authenticated")return;
    let seasonFragment:ReturnType<typeof buildSeasonPublishFragment>|null=null;
    if(mediaType==="tv"){
      if(!season||!season.episodes.some(e=>e.episode_number===episodeNumber)){setMessage("Choisis un épisode valide.");return;}
      const assessment=assessTmdbSeason({
        season,
        requestedSeasonNumber:seasonNumber,
        referenceEpisodeCount:referenceEpisodeCountForSeason(detail,seasonNumber),
      });
      const firstPlan=planSeasonPublication({assessment,confirmed:false});
      if(firstPlan.action==="blocked"){setMessage(assessment.message);return;}
      let confirmed=false;
      if(firstPlan.action==="confirm"){
        // `replaceSeason` deletes D1 rows. It is only offered after a verified
        // complete season and an explicit confirmation. A cancelled dialog
        // stops the publication entirely.
        confirmed=window.confirm(buildSeasonConfirmationMessage({seasonNumber,episodeCount:assessment.episodeCount}));
        if(!confirmed){setMessage("Publication annulée : aucune donnée n’a été modifiée.");return;}
      }
      const plan=planSeasonPublication({assessment,confirmed});
      if(plan.action==="blocked"){setMessage(plan.message);return;}
      seasonFragment=buildSeasonPublishFragment({season,seasonNumber,episodeNumber,replaceSeason:plan.replaceSeason});
    }
    setSaving(true);setMessage("");
    try{
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
        ...(seasonFragment??{})
      };
      const result=await adminJson("/api/catalog/publish",{method:"POST",body:JSON.stringify(payload)}) as {error?:string;published?:boolean;mode?:string};
      if(!result.published)throw new Error(result.error||"Publication impossible.");
      setMessage(mediaType==="tv"
        ?(result.mode==="replaceSeason"
          ?"Saison remplacée dans le catalogue partagé. Les fichiers Bunny restent intacts."
          :"Saison publiée en mode non destructif : les épisodes absents ont été conservés.")
        :"Film publié avec sa vidéo Bunny.");
      await refresh();
    }catch(e){
      if(isAdminAuthError(e)&&e.status===401)setAuthState("anonymous");
      setMessage(e instanceof Error?e.message:"Publication impossible.");
    }
    finally{setSaving(false);}
  };

  const seasonAssessment=mediaType==="tv"&&detail&&season
    ?assessTmdbSeason({season,requestedSeasonNumber:seasonNumber,referenceEpisodeCount:referenceEpisodeCountForSeason(detail,seasonNumber)})
    :null;
  const seasonNotice=describeSeasonAssessment(seasonAssessment);

  return <section className="bunny-panel" aria-label="Bibliothèque Bunny Stream">
    <header className="bunny-panel-header">
      <div className="bunny-panel-heading">
        <div className="eyebrow">STREAM · BUNNY</div>
        <h3>Bibliothèque Bunny</h3>
        <p>{data?.total??0} vidéo(s) hébergée(s) · sélectionne une vidéo pour créer sa fiche</p>
      </div>
      {authState==="authenticated"&&<button type="button" className="bunny-ghost-btn" onClick={()=>void refresh()} disabled={loading}>{loading?<LoaderCircle size={13} className="admin-spin"/>:<RefreshCw size={13}/>} Actualiser</button>}
    </header>

    <AdminSessionPanel
      authState={authState}
      password={password}
      loggingIn={loggingIn}
      onPasswordChange={setPassword}
      onLogin={login}
      onLogout={()=>void logout()}
      description="Connecte-toi comme administrateur pour charger la bibliothèque Bunny et associer ses vidéos aux fiches CinéBox."
      status={data?`${data.total} vidéo${data.total===1?"":"s"} · bibliothèque ${data.libraryId}`:undefined}
      className="bunny-session"
    />

    {error&&<p role="alert" className="bunny-alert">{error}</p>}

    {authState==="authenticated"&&<div className="bunny-workspace">
      <div className="bunny-list" aria-label="Vidéos hébergées dans Bunny">
        {loading&&!data&&<div className="bunny-loading"><LoaderCircle size={18} className="admin-spin"/><span>Chargement de la bibliothèque…</span></div>}
        {data?.videos.map(video=><button key={video.id} type="button" onClick={()=>void selectVideo(video)} className={`bunny-list-item ${selectedVideo?.id===video.id?"is-selected":""}`.trim()}>
          {video.thumbnailUrl?<img src={video.thumbnailUrl} alt="" loading="lazy"/>:<span className="bunny-list-thumb" aria-hidden="true"><Video size={17}/></span>}
          <span className="bunny-list-copy"><strong>{video.title}</strong><small>{video.durationSeconds?`${Math.round(video.durationSeconds/60)} min`:"Durée en traitement"} · <code>{video.id}</code></small></span>
          <ChevronRight size={15} aria-hidden="true"/>
        </button>)}
        {!loading&&data?.videos.length===0&&<div className="bunny-empty"><Video size={20}/><strong>Aucune vidéo dans Bunny</strong><span>Les fichiers téléversés apparaîtront ici.</span></div>}
      </div>

      <div className="bunny-detail">
        {!selectedVideo?<div className="bunny-placeholder"><Video size={26}/><strong>Sélectionne une vidéo Bunny</strong><span>Choisis un fichier hébergé pour créer ou compléter sa fiche CinéBox.</span></div>:<>
          <div className="bunny-detail-head">
            <div><strong>{selectedVideo.title}</strong><p>Fichier déjà hébergé · aucun nouvel envoi</p></div>
            <button type="button" className="bunny-ghost-btn" onClick={()=>setPreview(selectedVideo)}><Play size={13}/> Aperçu</button>
          </div>
          <div className="bunny-detail-facts">
            <span><Video size={11} aria-hidden="true"/> {selectedVideo.durationSeconds?`${Math.round(selectedVideo.durationSeconds/60)} min`:"Durée en traitement"}</span>
            <span><code>{selectedVideo.id}</code></span>
            <span>{selectedVideo.status!=null?`Statut Bunny ${selectedVideo.status}`:"Statut Bunny inconnu"}</span>
          </div>
          <label className="bunny-label">Recherche TMDB</label>
          <div className="bunny-search-row"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void (async()=>{setSearching(true);try{const r=await fetch("/api/tmdb/search?query="+encodeURIComponent(query)+"&kind=multi");const j=await r.json();setHits((j.results||[]).filter((x:TmdbHit)=>x.media_type==="movie"||x.media_type==="tv"));}finally{setSearching(false);}})();}} style={{...inputStyle,flex:1}}/><button type="button" className="bunny-ghost-btn" disabled={searching||!query.trim()} onClick={async()=>{setSearching(true);try{const r=await fetch("/api/tmdb/search?query="+encodeURIComponent(query)+"&kind=multi");const j=await r.json();setHits((j.results||[]).filter((x:TmdbHit)=>x.media_type==="movie"||x.media_type==="tv"));}catch{setMessage("Recherche TMDB impossible.");}finally{setSearching(false);}}}>{searching?<LoaderCircle size={14} className="admin-spin"/>:<Search size={14}/>}</button></div>
          {hits.length>0&&!detail&&<div className="bunny-hits">{hits.map(hit=><button key={hit.id+"-"+hit.media_type} type="button" onClick={()=>void chooseHit(hit)} className="bunny-hit">{hit.poster_path?<img src={image(hit.poster_path,"w92")} alt=""/>:<span className="bunny-hit-cover" aria-hidden="true"/>}<span><strong>{hit.title||hit.name}</strong><small>{hit.media_type==="tv"?"Série":"Film"} · {(hit.release_date||hit.first_air_date||"").slice(0,4)} · TMDB {hit.vote_average?.toFixed(1)||"—"}</small></span><ChevronRight size={14}/></button>)}</div>}
          {detail&&<div className="bunny-detail-body">
            <div className="bunny-detail-overview">{detail.poster_path&&<img src={image(detail.poster_path)} alt=""/>}<div><strong>{detail.title||detail.name}</strong><p>{detail.overview||"Synopsis indisponible."}</p><small><Star size={11} aria-hidden="true"/> {detail.vote_average?.toFixed(1)||"—"} · {detail.vote_count??0} votes · {(detail.release_date||detail.first_air_date||"").slice(0,4)}</small><p className="bunny-genres">{(detail.genres||[]).map(g=>g.name).join(" · ")}</p></div></div>
            {mediaType==="tv"&&<div className="bunny-season-grid"><div><label className="bunny-label">Saison</label><select value={seasonNumber} onChange={e=>{const n=Number(e.target.value);setSeasonNumber(n);void loadSeason(detail.id,n);}} style={inputStyle}>{(detail.seasons||[]).map(s=><option key={s.season_number} value={s.season_number}>{s.name||"Saison "+s.season_number}</option>)}</select></div><div><label className="bunny-label">Épisode</label><select value={episodeNumber} onChange={e=>setEpisodeNumber(Number(e.target.value))} style={inputStyle} disabled={loadingSeason||!season}>{(season?.episodes||[]).map(ep=><option key={ep.episode_number} value={ep.episode_number}>E{String(ep.episode_number).padStart(2,"0")} · {ep.name}</option>)}</select></div></div>}
            {mediaType==="tv"&&season&&<div role={seasonAssessment?.blocking?"alert":"status"} className={`bunny-season-notice is-${seasonNotice.tone}`}><strong>{seasonNotice.title}</strong><span>{seasonNotice.text}</span></div>}
            <div className="bunny-cast"><strong>Casting et avis TMDB</strong><p>{(detail.credits?.cast||[]).slice(0,6).map(c=>c.name).join(" · ")||"Casting non disponible"}</p><p>{reviews.length} avis TMDB récupérés · {(detail.credits?.crew||[]).find(c=>c.job==="Director")?.name||"Réalisation non renseignée"}</p></div>
            <button type="button" className="bunny-publish" disabled={saving||authState!=="authenticated"||(mediaType==="tv"&&(!season||seasonAssessment?.blocking===true))} onClick={()=>void publish()}>{saving?<LoaderCircle size={15} className="admin-spin"/>:<Check size={15}/>} {mediaType==="tv"&&seasonAssessment?.complete?"Remplacer la saison et associer la vidéo":"Publier la fiche et associer la vidéo"}</button>
          </div>}
          {message&&<p role="status" className="bunny-message">{message}</p>}
        </>}
      </div>
    </div>}

    {preview&&data&&<div className="bunny-preview" onClick={e=>{if(e.target===e.currentTarget)setPreview(null);}}><div ref={previewDialogRef} {...previewDialogProps} className="bunny-preview-dialog" aria-label={`Aperçu de ${preview.title}`}><div className="bunny-preview-head"><strong>{preview.title}</strong><button ref={previewCloseRef} type="button" className="bunny-ghost-btn" onClick={()=>setPreview(null)} aria-label="Fermer l’aperçu"><X size={15}/></button></div><div className="bunny-preview-frame"><iframe title={preview.title} src={`https://iframe.mediadelivery.net/embed/${data.libraryId}/${preview.id}`} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowFullScreen/></div></div></div>}
  </section>;
}
