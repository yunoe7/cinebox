"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Heart, Play, Settings, X, Bookmark, Info, Film, ChevronRight, ListVideo, Star, Clock } from "lucide-react";
import type { Title } from "../../lib/cinebox/types";
import BunnyPlayer from "./BunnyPlayer";
import VidsrcPlayer from "./VidsrcPlayer";
import VideoPlayer from "./VideoPlayer";
import { isBunnyEmbedUrl } from "../../lib/cinebox/bunny-playback.mjs";
import { retainBlobUrl } from "../../lib/cinebox/blob-url-manager.mjs";
import { MagicCard } from "../magicui/magic-card";
import { BlurFade } from "../magicui/blur-fade";
import { useModalDialog } from "./useModalDialog";

type SelectedEpisode = { season: number; episode: number };
type DetailModalProps = {
  selected: Title | null; selectedEpisodeUrl: string | null; selectedEpisode: SelectedEpisode | null;
  activePage: string; favorites: number[]; onClose: () => void;
  onSelectEpisode: (season: number, episode: number, url: string) => void;
  onEditEpisode: (season: number, episode: number, title: string) => void;
  onToggleFavorite: (id: number) => void;
  onProgress: (titleId: number, episode: SelectedEpisode | null, second: number, progress: number) => void;
  onEnded: (title: Title, episode: SelectedEpisode | null) => void; onView: (titleId: number) => void;
};

export default function DetailModal({ selected, selectedEpisodeUrl, selectedEpisode, activePage, favorites, onClose, onSelectEpisode, onEditEpisode, onToggleFavorite, onProgress, onEnded, onView }: DetailModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<"details" | "episodes">("details");
  const [activeSeasonNumber, setActiveSeasonNumber] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackSource, setPlaybackSource] = useState<"bunny" | "vidsrc">("bunny");
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const { ref: dialogRef, dialogProps } = useModalDialog<HTMLDivElement>({
    active: Boolean(selected),
    onClose,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (!selected) return;
    const urls = new Set<string>();
    const add = (url: string | undefined) => { if (url?.startsWith("blob:")) urls.add(url); };
    add(selected.poster);
    add(selected.backdrop);
    add(selected.videoUrl);
    for (const season of selected.seasons || []) {
      for (const episode of season.episodes) { add(episode.videoUrl); add(episode.thumbnailUrl); }
    }
    if (selectedEpisodeUrl?.startsWith("blob:")) urls.add(selectedEpisodeUrl);
    const leases = [...urls].map(retainBlobUrl);
    return () => leases.forEach((lease) => lease.release());
  }, [selected, selectedEpisodeUrl]);

  useEffect(() => {
    if (!selected) return;
    setActiveTab("details"); setPlaying(false); setPlaybackSource(selected.videoUrl || selected.seasons?.some(season => season.episodes.some(episode => episode.videoUrl)) ? "bunny" : "vidsrc"); setExpanded(false);
    setActiveSeasonNumber(selectedEpisode?.season ?? selected.seasons?.[0]?.number ?? null);
  }, [selected?.id]);

  useEffect(() => {
    if (selectedEpisode) setActiveSeasonNumber(selectedEpisode.season);
  }, [selectedEpisode?.season]);

  if (!selected) return null;
  const episodes = selected.seasons?.flatMap(season => season.episodes.filter(ep => ep.videoUrl).map(ep => ({ season: season.number, episode: ep.number, url: ep.videoUrl! }))) || [];
  const chosen = selectedEpisode ? episodes.find(ep => ep.season === selectedEpisode.season && ep.episode === selectedEpisode.episode) : undefined;
  const playbackUrl = selectedEpisodeUrl || chosen?.url || selected.videoUrl || episodes[0]?.url || null;
  const playbackProgress = selectedEpisode
    ? selected.seasons?.find(season => season.number === selectedEpisode.season)?.episodes.find(episode => episode.number === selectedEpisode.episode)?.progress ?? 0
    : selected.progress ?? 0;
  const playbackResumeAt = playbackProgress > 0 && playbackProgress < 100
    ? (selectedEpisode
      ? selected.seasons?.find(season => season.number === selectedEpisode.season)?.episodes.find(episode => episode.number === selectedEpisode.episode)?.currentTime ?? 0
      : selected.currentTime ?? 0)
    : 0;
  const canPlay = Boolean(selected.videoUrl || episodes.length || (selected.tmdbId && (selected.kind === "Film" || selected.kind === "Série")));
  const resumableEpisode = selected.seasons?.flatMap(season => season.episodes
    .filter(episode => Boolean(episode.videoUrl) && (episode.progress || 0) > 0 && (episode.progress || 0) < 100)
    .map(episode => ({ season: season.number, episode })))
    .sort((a, b) => (b.episode.currentTime || 0) - (a.episode.currentTime || 0))[0];
  const titleCanResume = Boolean(selected.videoUrl && (selected.progress || 0) > 0 && (selected.progress || 0) < 100);
  const canResume = selected.kind === "Série" ? Boolean(resumableEpisode) : titleCanResume;
  const progressLabel = selected.kind === "Série" ? resumableEpisode?.episode.progress : selected.progress;
  const activeSeason = selected.seasons?.find(season => season.number === activeSeasonNumber) || selected.seasons?.[0];
  const genres = selected.genres?.filter(Boolean).join(" · ") || selected.genre?.trim();
  const hasDescription = Boolean(selected.description?.trim());
  const hasDuration = Boolean(selected.duration?.trim());
  const durationIsSeasonCount = selected.kind === "Série" && /^\s*\d+\s+saisons?\s*$/i.test(selected.duration || "");
  const showDuration = hasDuration && !durationIsSeasonCount;
  const hasRating = typeof selected.rating === "number" && Number.isFinite(selected.rating) && selected.rating > 0;
  const play = (resume = false) => {
    if (!playbackUrl && !selected.tmdbId) return;
    if (resume && resumableEpisode?.episode.videoUrl) {
      onSelectEpisode(resumableEpisode.season, resumableEpisode.episode.number, resumableEpisode.episode.videoUrl);
    } else if (!selected.videoUrl && !selectedEpisode && episodes[0]) {
      onSelectEpisode(episodes[0].season, episodes[0].episode, episodes[0].url);
    }
    setPlaybackSource((current) => current === "bunny" && (selected.videoUrl || episodes.length) ? "bunny" : "vidsrc");
    setPlaying(true); onView(selected.id);
  };

  return <AnimatePresence>
    <motion.div className="modal-backdrop detail-page-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div ref={dialogRef} {...dialogProps} className="detail-modal detail-page-modal" aria-labelledby="detail-modal-title" initial={reduceMotion ? false : { y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduceMotion ? { opacity: 0 } : { y: 10, opacity: 0 }}>
        <button ref={closeButtonRef} className="close-btn detail-page-close" type="button" aria-label="Fermer les détails" onClick={onClose}><X/></button>
        {playing && playbackUrl ? <section className="episode-watch-page">
          <div className="episode-watch-top">
            <div className="episode-watch-player">
              {playbackSource === "vidsrc" && selected.tmdbId && (selected.kind === "Film" || selected.kind === "Série") ? <VidsrcPlayer key={`vidsrc:${selected.tmdbId}:${selectedEpisode?.season ?? ""}:${selectedEpisode?.episode ?? ""}`} kind={selected.kind === "Film" ? "movie" : "tv"} id={selected.tmdbId} season={selectedEpisode?.season} episode={selectedEpisode?.episode} resumeAt={playbackResumeAt} title={`${selected.name}${selectedEpisode ? ` · S${selectedEpisode.season}E${selectedEpisode.episode}` : ""}`} onProgress={(second, progress) => onProgress(selected.id, selectedEpisode, second, progress)} onEnded={() => onEnded(selected, selectedEpisode)}/> : isBunnyEmbedUrl(playbackUrl || "") ? <BunnyPlayer key={playbackUrl} src={playbackUrl!} resumeAt={playbackResumeAt} title={`${selected.name}${selectedEpisode ? ` · S${selectedEpisode.season}E${selectedEpisode.episode}` : ""}`}
                onProgress={(second, progress) => onProgress(selected.id, selectedEpisode, second, progress)} onEnded={() => onEnded(selected, selectedEpisode)}/> : playbackUrl ? <VideoPlayer key={playbackUrl} src={playbackUrl} resumeAt={playbackResumeAt}
                onProgress={(second, progress) => onProgress(selected.id, selectedEpisode, second, progress)} onEnded={() => onEnded(selected, selectedEpisode)} onView={() => undefined}/> : null}
            </div>
            <aside className="episode-watch-sidebar">
              <div className="eyebrow">VOUS REGARDEZ</div>
              <div className="episode-watch-title-card">{selected.poster ? <img src={selected.poster} alt=""/> : <span className="artwork-empty" aria-hidden="true"/>}<div><strong>{selected.name}</strong><small>{selected.year} · {selected.kind}</small><button type="button" onClick={() => setPlaying(false)}>Voir la fiche <ChevronRight size={13}/></button></div></div>
              <h3>Informations</h3>
              <dl><div><dt>Format</dt><dd>{selected.kind}</dd></div><div><dt>Année</dt><dd>{selected.year}</dd></div><div><dt>Genre</dt><dd>{selected.genre}</dd></div>{selected.seasons?.length ? <div><dt>Saisons</dt><dd>{selected.seasons.length}</dd></div> : null}</dl>
              <h3>Synopsis</h3><p>{selected.description}</p>
            </aside>
          </div>
          <div className="episode-watch-controls">
            <div><span className="eyebrow">{selected.name.toUpperCase()}</span><h2>{selectedEpisode ? `Saison ${selectedEpisode.season} · Épisode ${selectedEpisode.episode}` : selected.name}</h2></div>
            {(selected.videoUrl || episodes.length > 0) && selected.tmdbId && <div role="group" aria-label="Choisir la source de lecture" className="vidsrc-source-switch">
              <button type="button" aria-pressed={playbackSource === "bunny"} className={playbackSource === "bunny" ? "active" : ""} onClick={() => setPlaybackSource("bunny")}>Bunny Stream</button>
              <button type="button" aria-pressed={playbackSource === "vidsrc"} className={playbackSource === "vidsrc" ? "active" : ""} onClick={() => setPlaybackSource("vidsrc")}>Vidsrc</button>
            </div>}

            {episodes.length > 0 && <label className="episode-watch-picker"><ListVideo size={15}/><select aria-label="Choisir un épisode" value={selectedEpisode ? `${selectedEpisode.season}:${selectedEpisode.episode}` : `${episodes[0].season}:${episodes[0].episode}`} onChange={event => { const [season,episode] = event.target.value.split(":").map(Number); const target = episodes.find(ep => ep.season === season && ep.episode === episode); if (target) onSelectEpisode(target.season,target.episode,target.url); }}>{episodes.map(ep => <option key={`${ep.season}:${ep.episode}`} value={`${ep.season}:${ep.episode}`}>S{ep.season} · E{ep.episode}</option>)}</select></label>}
            {(() => { const index = episodes.findIndex(ep => ep.season === selectedEpisode?.season && ep.episode === selectedEpisode?.episode); const next = episodes[index + 1]; return next ? <button className="episode-next-button" type="button" onClick={() => onSelectEpisode(next.season,next.episode,next.url)}>Suivant <ChevronRight size={15}/></button> : null; })()}
            <button className="detail-back-to-info" type="button" onClick={() => setPlaying(false)}>Retour à la fiche</button>
          </div>
          <div className="episode-watch-synopsis"><h3>Synopsis</h3><p>{selected.description}</p></div>
        </section> : <section className="detail-page-hero" style={{ backgroundImage: `linear-gradient(90deg,rgba(8,10,14,.97),rgba(8,10,14,.78) 48%,rgba(8,10,14,.2)),linear-gradient(0deg,#11141a,transparent 60%),${selected.backdrop || selected.poster ? `url("${selected.backdrop || selected.poster}")` : "none"}` }}>
          <MagicCard className="detail-page-hero-card">
          <BlurFade className="detail-page-hero-content" duration={0.45}>
            <div className="eyebrow">CINÉBOX ORIGINALS · {selected.kind.toUpperCase()}</div>
            <span className="detail-page-tag">{selected.kind === "Série" ? "À SUIVRE" : "À DÉCOUVRIR"}</span>
            <h2 id="detail-modal-title">{selected.name}</h2>
            <div className="detail-page-meta">
              {selected.year > 0 && <span>{selected.year}</span>}
              {genres && <><i>·</i><span>{genres}</span></>}
              {showDuration && <><i>·</i><span className="detail-meta-duration"><Clock size={12}/>{selected.duration}</span></>}
              {selected.seasons?.length ? <><i>·</i><span>{selected.seasons.length} saison{selected.seasons.length === 1 ? "" : "s"}</span></> : null}
              {hasRating && <span className="detail-rating" aria-label={`Note TMDB ${selected.rating!.toFixed(1)} sur 10`}><Star size={13} fill="currentColor"/> {selected.rating!.toFixed(1)} <small>TMDB</small></span>}
            </div>
            {hasDescription && <><p className={expanded ? "detail-page-description expanded" : "detail-page-description"}>{selected.description}</p>
              {selected.description.length > 145 && <button className="detail-more" type="button" onClick={() => setExpanded(v => !v)}>{expanded ? "Voir moins" : "Voir plus"}</button>}</>}
            <div className="detail-page-actions">
              <button className="gold-btn" type="button" disabled={!canPlay} onClick={() => play(canResume)}><Play size={15} fill="currentColor"/> {canResume ? "Reprendre" : selected.kind === "Série" ? "Lire le premier épisode" : "Lecture"}</button>
              {canResume && typeof progressLabel === "number" && <span className="detail-resume-progress">{Math.round(progressLabel)} % regardé</span>}
              <button className="detail-secondary-btn" type="button" onClick={() => setActiveTab("details")}><Info size={15}/> Plus d'infos</button>
              <button className={`detail-icon-btn ${favorites.includes(selected.id) ? "is-fav" : ""}`} type="button" aria-label="Ajouter à ma liste" aria-pressed={favorites.includes(selected.id)} onClick={() => onToggleFavorite(selected.id)}><Heart size={17} fill={favorites.includes(selected.id) ? "currentColor" : "none"}/></button>
            </div>
            {!canPlay && <span className="detail-no-video">Aucun fichier vidéo associé pour le moment.</span>}
          </BlurFade>
          </MagicCard>
        </section>}
        <nav className="detail-tabs" aria-label="Informations du titre">
          <button type="button" className={activeTab === "details" ? "active" : ""} onClick={() => setActiveTab("details")}><Info size={15}/> Synopsis & détails</button>
          {selected.kind === "Série" && <button type="button" className={activeTab === "episodes" ? "active" : ""} onClick={() => setActiveTab("episodes")}><Film size={15}/> Saisons & épisodes <span>{selected.seasons?.reduce((n,s) => n + s.episodes.length,0) || 0}</span></button>}
        </nav>
        <div className="detail-page-body">
          {activeTab === "details" ? <div className={`detail-overview ${selected.poster ? "has-poster" : "without-poster"}`}>
            {selected.poster && <div className="detail-overview-poster"><img src={selected.poster} alt={`Affiche de ${selected.name}`}/></div>}
            <MagicCard className="detail-overview-copy"><div className="eyebrow">À PROPOS DE CE TITRE</div><h3>{selected.name}</h3>{hasDescription && <p>{selected.description}</p>}
              <dl><div><dt>Type</dt><dd>{selected.kind}</dd></div>{selected.year > 0 && <div><dt>Année</dt><dd>{selected.year}</dd></div>}{genres && <div><dt>Genres</dt><dd>{genres}</dd></div>}{showDuration && <div><dt>Durée</dt><dd>{selected.duration}</dd></div>}{hasRating && <div><dt>Note TMDB</dt><dd className="detail-rating"><Star size={13} fill="currentColor"/> {selected.rating!.toFixed(1)} / 10{typeof selected.voteCount === "number" && selected.voteCount > 0 ? <small> · {selected.voteCount.toLocaleString("fr-FR")} votes</small> : null}</dd></div>}{selected.collection && <div><dt>Collection</dt><dd>{selected.collection}</dd></div>}{selected.director && <div><dt>Réalisation</dt><dd>{selected.director}</dd></div>}{selected.cast?.length ? <div className="detail-overview-cast"><dt>Distribution</dt><dd>{selected.cast.join(", ")}</dd></div> : null}</dl>
            </MagicCard>
          </div> : <div className="detail-seasons">
            {selected.seasons?.length ? <>
              <div className="detail-season-selector"><label htmlFor="detail-season-select"><span className="eyebrow">PARCOURIR LES ÉPISODES</span><strong>Saison</strong></label><select id="detail-season-select" aria-label="Choisir une saison" value={activeSeason?.number ?? ""} onChange={event => setActiveSeasonNumber(Number(event.target.value))}>{selected.seasons.map(season => <option key={season.number} value={season.number}>{season.name || `Saison ${season.number}`}</option>)}</select><span>{activeSeason?.episodes.length || 0} épisode{activeSeason?.episodes.length === 1 ? "" : "s"}</span></div>
              {activeSeason && <section className="detail-season" key={activeSeason.number}>
              <div className="detail-season-heading"><div><span className="eyebrow">CINÉBOX · {activeSeason.name || `SAISON ${activeSeason.number}`}</span><h3>{activeSeason.name || `Saison ${activeSeason.number}`}</h3>{activeSeason.overview && <p>{activeSeason.overview}</p>}</div><span>{activeSeason.episodes.length} épisode{activeSeason.episodes.length === 1 ? "" : "s"}</span></div>
              <div className="detail-episode-grid">{activeSeason.episodes.map(episode => {
                const active = selectedEpisode?.season === activeSeason.number && selectedEpisode?.episode === episode.number;
                const progress = Math.max(0, Math.min(100, episode.progress || 0));
                return <MagicCard className={`detail-episode-card ${active ? "active" : ""}`} key={episode.number}>
                  <button type="button" className="detail-episode-main" disabled={!episode.videoUrl && !selected.tmdbId} onClick={() => { onSelectEpisode(activeSeason.number,episode.number,episode.videoUrl || ""); setPlaybackSource(episode.videoUrl ? "bunny" : "vidsrc"); setPlaying(true); }}>
                    <span className="detail-episode-thumb">{episode.thumbnailUrl ? <img src={episode.thumbnailUrl} alt=""/> : <span>{String(episode.number).padStart(2,"0")}</span>}<i><Play size={15} fill="currentColor"/></i></span>
                    <span className="detail-episode-text"><strong>{episode.title}</strong><small>{episode.runtime && episode.runtime > 0 ? `${episode.runtime} min · ` : ""}{episode.videoUrl ? (progress >= 100 ? "Terminé" : progress ? `${Math.round(progress)} % regardé` : "Prêt à lire") : "Vidéo non associée"}</small>{episode.overview && <span>{episode.overview}</span>}{progress > 0 && <span className="detail-episode-progress" role="progressbar" aria-label={`Progression de ${episode.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }}/></span>}</span>
                  </button>
                  {activePage === "Administration" && <button className="detail-episode-edit" title="Modifier cet épisode" aria-label={`Modifier ${episode.title}`} onClick={() => onEditEpisode(activeSeason.number,episode.number,episode.title)}><Settings size={14}/></button>}
                </MagicCard>;
              })}</div>
            </section>}
            </> : <p className="detail-empty">Aucune saison n'a encore été ajoutée.</p>}
          </div>}
          <div className="detail-bottom-actions"><span><Bookmark size={14}/> {favorites.includes(selected.id) ? "Enregistré dans ma liste" : "Retrouvez ce titre dans votre liste."}</span><button className={`outline-btn ${favorites.includes(selected.id) ? "is-fav" : ""}`} type="button" onClick={() => onToggleFavorite(selected.id)}><Heart size={15}/> {favorites.includes(selected.id) ? "Dans ma liste" : "Ajouter à ma liste"}</button></div>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>;
}
