"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Heart, Play, Settings, X, Bookmark, Info, Film, ChevronRight, ListVideo } from "lucide-react";
import type { Title } from "../../lib/cinebox/types";
import VideoPlayer from "./VideoPlayer";

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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [activeTab, setActiveTab] = useState<"details" | "episodes">("details");
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setActiveTab("details"); setPlaying(false); setExpanded(false);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [selected?.id]);

  if (!selected) return null;
  const episodes = selected.seasons?.flatMap(season => season.episodes.filter(ep => ep.videoUrl).map(ep => ({ season: season.number, episode: ep.number, url: ep.videoUrl! }))) || [];
  const chosen = selectedEpisode ? episodes.find(ep => ep.season === selectedEpisode.season && ep.episode === selectedEpisode.episode) : undefined;
  const playbackUrl = selectedEpisodeUrl || chosen?.url || selected.videoUrl || episodes[0]?.url || null;
  const canPlay = Boolean(selected.videoUrl || episodes.length);
  const play = () => {
    if (!playbackUrl) return;
    if (!selected.videoUrl && !selectedEpisode && episodes[0]) onSelectEpisode(episodes[0].season, episodes[0].episode, episodes[0].url);
    setPlaying(true); onView(selected.id);
  };

  return <AnimatePresence>
    <motion.div className="modal-backdrop detail-page-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div className="detail-modal detail-page-modal" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}>
        <button ref={closeButtonRef} className="close-btn detail-page-close" type="button" aria-label="Fermer les détails" onClick={onClose}><X/></button>
        {playing && playbackUrl ? <section className="episode-watch-page">
          <div className="episode-watch-top">
            <div className="episode-watch-player">
              <VideoPlayer key={playbackUrl} src={playbackUrl} resumeAt={selectedEpisode ? selected.seasons?.find(s => s.number === selectedEpisode.season)?.episodes.find(ep => ep.number === selectedEpisode.episode)?.currentTime ?? 0 : selected.currentTime ?? 0}
                onProgress={(second, progress) => onProgress(selected.id, selectedEpisode, second, progress)} onEnded={() => onEnded(selected, selectedEpisode)} onView={() => undefined}/>
            </div>
            <aside className="episode-watch-sidebar">
              <div className="eyebrow">VOUS REGARDEZ</div>
              <div className="episode-watch-title-card"><img src={selected.poster} alt=""/><div><strong>{selected.name}</strong><small>{selected.year} · {selected.kind}</small><button type="button" onClick={() => setPlaying(false)}>Voir la fiche <ChevronRight size={13}/></button></div></div>
              <h3>Informations</h3>
              <dl><div><dt>Format</dt><dd>{selected.kind}</dd></div><div><dt>Année</dt><dd>{selected.year}</dd></div><div><dt>Genre</dt><dd>{selected.genre}</dd></div>{selected.seasons?.length ? <div><dt>Saisons</dt><dd>{selected.seasons.length}</dd></div> : null}</dl>
              <h3>Synopsis</h3><p>{selected.description}</p>
            </aside>
          </div>
          <div className="episode-watch-controls">
            <div><span className="eyebrow">{selected.name.toUpperCase()}</span><h2>{selectedEpisode ? `Saison ${selectedEpisode.season} · Épisode ${selectedEpisode.episode}` : selected.name}</h2></div>
            {episodes.length > 0 && <label className="episode-watch-picker"><ListVideo size={15}/><select aria-label="Choisir un épisode" value={selectedEpisode ? `${selectedEpisode.season}:${selectedEpisode.episode}` : `${episodes[0].season}:${episodes[0].episode}`} onChange={event => { const [season,episode] = event.target.value.split(":").map(Number); const target = episodes.find(ep => ep.season === season && ep.episode === episode); if (target) onSelectEpisode(target.season,target.episode,target.url); }}>{episodes.map(ep => <option key={`${ep.season}:${ep.episode}`} value={`${ep.season}:${ep.episode}`}>S{ep.season} · E{ep.episode}</option>)}</select></label>}
            {(() => { const index = episodes.findIndex(ep => ep.season === selectedEpisode?.season && ep.episode === selectedEpisode?.episode); const next = episodes[index + 1]; return next ? <button className="episode-next-button" type="button" onClick={() => onSelectEpisode(next.season,next.episode,next.url)}>Suivant <ChevronRight size={15}/></button> : null; })()}
            <button className="detail-back-to-info" type="button" onClick={() => setPlaying(false)}>Retour à la fiche</button>
          </div>
          <div className="episode-watch-synopsis"><h3>Synopsis</h3><p>{selected.description}</p></div>
        </section> : <section className="detail-page-hero" style={{ backgroundImage: `linear-gradient(90deg,rgba(8,10,14,.97),rgba(8,10,14,.78) 48%,rgba(8,10,14,.2)),linear-gradient(0deg,#11141a,transparent 60%),url("${selected.poster || selected.backdrop}")` }}>
          <div className="detail-page-hero-content">
            <div className="eyebrow">CINÉBOX ORIGINALS · {selected.kind.toUpperCase()}</div>
            <span className="detail-page-tag">{selected.kind === "Série" ? "SÉRIE À DÉCOUVRIR" : "À DÉCOUVRIR"}</span>
            <h2 id="detail-modal-title">{selected.name}</h2>
            <div className="detail-page-meta"><span>{selected.year}</span><i>·</i><span>{selected.genre}</span><i>·</i><span>{selected.duration}</span>{selected.seasons?.length ? <><i>·</i><span>{selected.seasons.length} saison(s)</span></> : null}</div>
            <p className={expanded ? "detail-page-description expanded" : "detail-page-description"}>{selected.description}</p>
            {selected.description.length > 145 && <button className="detail-more" type="button" onClick={() => setExpanded(v => !v)}>{expanded ? "Voir moins" : "Voir plus"}</button>}
            <div className="detail-page-actions">
              <button className="gold-btn" type="button" disabled={!canPlay} onClick={play}><Play size={15} fill="currentColor"/> {selected.kind === "Série" ? "Lire le premier épisode" : "Lecture"}</button>
              <button className="detail-secondary-btn" type="button" onClick={() => setActiveTab("details")}><Info size={15}/> Plus d'infos</button>
              <button className={`detail-icon-btn ${favorites.includes(selected.id) ? "is-fav" : ""}`} type="button" aria-label="Ajouter à ma liste" aria-pressed={favorites.includes(selected.id)} onClick={() => onToggleFavorite(selected.id)}><Heart size={17} fill={favorites.includes(selected.id) ? "currentColor" : "none"}/></button>
            </div>
            {!canPlay && <span className="detail-no-video">Aucun fichier vidéo associé pour le moment.</span>}
          </div>
        </section>}
        <nav className="detail-tabs" aria-label="Informations du titre">
          <button type="button" className={activeTab === "details" ? "active" : ""} onClick={() => setActiveTab("details")}><Info size={15}/> Synopsis & détails</button>
          {selected.kind === "Série" && <button type="button" className={activeTab === "episodes" ? "active" : ""} onClick={() => setActiveTab("episodes")}><Film size={15}/> Saisons & épisodes <span>{selected.seasons?.reduce((n,s) => n + s.episodes.length,0) || 0}</span></button>}
        </nav>
        <div className="detail-page-body">
          {activeTab === "details" ? <div className="detail-overview">
            <div className="detail-overview-poster"><img src={selected.poster} alt={`Affiche de ${selected.name}`}/></div>
            <div className="detail-overview-copy"><div className="eyebrow">À PROPOS DE CE TITRE</div><h3>{selected.name}</h3><p>{selected.description}</p>
              <dl><div><dt>Type</dt><dd>{selected.kind}</dd></div><div><dt>Année</dt><dd>{selected.year}</dd></div><div><dt>Genre</dt><dd>{selected.genre}</dd></div><div><dt>Durée</dt><dd>{selected.duration}</dd></div>{selected.collection && <div><dt>Collection</dt><dd>{selected.collection}</dd></div>}</dl>
            </div>
          </div> : <div className="detail-seasons">
            {selected.seasons?.map(season => <section className="detail-season" key={season.number}>
              <div className="detail-season-heading"><div><span className="eyebrow">CINÉBOX · SAISON {season.number}</span><h3>Saison {season.number}</h3></div><span>{season.episodes.length} épisode(s)</span></div>
              <div className="detail-episode-grid">{season.episodes.map(episode => {
                const active = selectedEpisode?.season === season.number && selectedEpisode?.episode === episode.number;
                return <div className={`detail-episode-card ${active ? "active" : ""}`} key={episode.number}>
                  <button type="button" className="detail-episode-main" disabled={!episode.videoUrl} onClick={() => { onSelectEpisode(season.number,episode.number,episode.videoUrl || ""); setPlaying(true); }}>
                    <span className="detail-episode-thumb">{episode.thumbnailUrl ? <img src={episode.thumbnailUrl} alt=""/> : <span>{String(episode.number).padStart(2,"0")}</span>}<i><Play size={15} fill="currentColor"/></i></span>
                    <span className="detail-episode-text"><strong>{episode.title}</strong><small>{episode.videoUrl ? ((episode.progress || 0) >= 100 ? "Terminé" : episode.progress ? `${Math.round(episode.progress)} % regardé` : "Prêt à lire") : "Vidéo non associée"}</small></span>
                  </button>
                  {activePage === "Administration" && <button className="detail-episode-edit" title="Modifier cet épisode" aria-label={`Modifier ${episode.title}`} onClick={() => onEditEpisode(season.number,episode.number,episode.title)}><Settings size={14}/></button>}
                </div>;
              })}</div>
            </section>)}
            {!selected.seasons?.length && <p className="detail-empty">Aucune saison n'a encore été ajoutée.</p>}
          </div>}
          <div className="detail-bottom-actions"><span><Bookmark size={14}/> {favorites.includes(selected.id) ? "Enregistré dans ma liste" : "Retrouvez ce titre dans votre liste."}</span><button className={`outline-btn ${favorites.includes(selected.id) ? "is-fav" : ""}`} type="button" onClick={() => onToggleFavorite(selected.id)}><Heart size={15}/> {favorites.includes(selected.id) ? "Dans ma liste" : "Ajouter à ma liste"}</button></div>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>;
}
