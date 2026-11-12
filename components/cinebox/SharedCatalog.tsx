"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import type { Title } from "../../lib/cinebox/types";
import { sharedNumericId, tmdbIdFromSharedId } from "../../lib/cinebox/shared-id.mjs";

type SharedEpisode = { number:number; title:string; overview?:string; runtime?:number|null; thumbnailPath?:string|null; videoUrl?:string|null; tmdbId?:number|null };
type SharedSeason = { number:number; episodes:SharedEpisode[] };
type SharedTitle = {
  id:string; kind:"movie"|"series"|"video"; title:string; overview:string; releaseDate:string|null;
  posterPath:string|null; backdropPath:string|null; genres:string[]; metadata?:Record<string,any>; seasons?:SharedSeason[];
};
type CatalogResponse = { titles: SharedTitle[] };
type Props = { onOpen: (title:Title)=>void; onFeatured?: (title:Title | null)=>void };

function isCatalogResponse(value: unknown): value is CatalogResponse {
  return !!value && typeof value==="object" && Array.isArray((value as CatalogResponse).titles);
}
const labels = { movie:"FILM", series:"SÉRIE", video:"VIDÉO" } as const;
const tmdbImage = (path?:string|null,size="w500") => path ? path.startsWith("http") ? path : `https://image.tmdb.org/t/p/${size}${path}` : "";
function toTitle(item:SharedTitle):Title {
  const metadata=item.metadata||{};
  const tmdbId=typeof metadata.tmdbId==="number"?metadata.tmdbId:tmdbIdFromSharedId(item.id);
  const seasons=(item.seasons||[]).map(season=>({
    number:season.number,
    episodes:season.episodes.map(ep=>({
      number:ep.number,title:ep.title,overview:ep.overview||"",
      runtime:typeof ep.runtime==="number"?ep.runtime:undefined,
      thumbnailUrl:tmdbImage(ep.thumbnailPath,"w300")||undefined,
      videoUrl:ep.videoUrl||undefined,tmdbId:ep.tmdbId||undefined
    }))
  }));
  const year=item.releaseDate?new Date(item.releaseDate).getUTCFullYear():0;
  const kind=item.kind==="series"?"Série":item.kind==="video"?"Vidéo":"Film";
  return {
    id:sharedNumericId({id:item.id,kind:item.kind,tmdbId:metadata.tmdbId}),name:item.title,kind,year:Number.isFinite(year)?year:0,
    genre:item.genres.join(" · "),genres:item.genres,description:item.overview||"",
    poster:tmdbImage(item.posterPath)||"",backdrop:tmdbImage(item.backdropPath)||"",
    progress:0,duration:metadata.runtime?String(metadata.runtime)+" min":kind==="Série"?`${seasons.length} saisons`:"",
    seasons:seasons.length?seasons:undefined,
    rating:typeof metadata.voteAverage==="number"?metadata.voteAverage:undefined,
    voteCount:typeof metadata.voteCount==="number"?metadata.voteCount:undefined,
    cast:Array.isArray(metadata.cast)?metadata.cast.map((person:any)=>typeof person==="string"?person:person.name).filter(Boolean):[],
    director:Array.isArray(metadata.directors)?metadata.directors.join(", "):undefined,
    tmdbId,sharedId:item.id,
    totalSeasons:seasons.length,totalEpisodes:seasons.reduce((sum,s)=>sum+s.episodes.length,0)
  };
}

/** Public catalogue cards open in the same detail and episode experience as the personal library. */
export function SharedCatalog({onOpen,onFeatured}:Props) {
  const [titles,setTitles]=useState<SharedTitle[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(false);
  useEffect(()=>{ onFeatured?.(titles.length ? toTitle(titles[0]) : null); },[titles,onFeatured]);
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/catalog?limit=50",{signal:controller.signal,headers:{accept:"application/json"}})
      .then(async response=>{
        if(!response.ok)throw new Error("Catalog unavailable");
        const value:unknown=await response.json();
        if(!isCatalogResponse(value))throw new Error("Invalid catalogue response");
        setTitles(value.titles);setError(false);
      })
      .catch(reason=>{if(reason instanceof Error&&reason.name==="AbortError")return;setError(true);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[]);
  if(loading||(!error&&titles.length===0))return null;
  return <section className="section-block" aria-labelledby="shared-catalog-heading">
    <div className="section-head"><div><div className="eyebrow">LE CATALOGUE COMMUN</div><h2 id="shared-catalog-heading">Publié sur <em>CinéBox</em></h2></div>{!error&&<span className="subtle">{titles.length} contenu{titles.length===1?"":"s"} publié{titles.length===1?"":"s"}</span>}</div>
    {error?<p role="status" className="subtle">Le catalogue partagé est momentanément indisponible. Votre bibliothèque personnelle reste accessible.</p>:
      <div className="poster-grid">{titles.map(item=>{
        const title=toTitle(item);
        return <article className="poster-card" key={item.id}>
          <button type="button" className="poster-open" onClick={()=>onOpen(title)} aria-label={`Ouvrir ${item.title}`}>
            <div className="poster-image">{title.poster?<img src={title.poster} alt={`Affiche de ${item.title}`} loading="lazy"/>:<span className="artwork-empty" aria-hidden="true"/>}<span className="kind-chip">{title.kind}</span><span className="poster-play"><Play size={20} fill="currentColor"/></span></div>
            <div className="poster-meta"><span>{item.genres.slice(0,2).join(" · ")||labels[item.kind]}</span><span>{title.year||""}</span></div>
            <strong>{title.name}</strong>
            {title.kind==="Série"&&title.seasons?.length?<div className="series-card-details"><span>{title.seasons.length} saison{title.seasons.length===1?"":"s"} · {title.totalEpisodes||0} épisode{title.totalEpisodes===1?"":"s"}</span></div>:null}
          </button>
        </article>;
      })}</div>}
  </section>;
}
