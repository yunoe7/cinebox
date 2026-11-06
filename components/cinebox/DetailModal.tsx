"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Heart, Play, Settings, X } from "lucide-react";
import type { Title } from "../../lib/cinebox/types";
import VideoPlayer from "./VideoPlayer";

type SelectedEpisode = { season: number; episode: number };

type DetailModalProps = {
  selected: Title | null;
  selectedEpisodeUrl: string | null;
  selectedEpisode: SelectedEpisode | null;
  activePage: string;
  favorites: number[];
  onClose: () => void;
  onSelectEpisode: (season: number, episode: number, url: string) => void;
  onEditEpisode: (season: number, episode: number, title: string) => void;
  onToggleFavorite: (id: number) => void;
  onProgress: (titleId: number, episode: SelectedEpisode | null, second: number, progress: number) => void;
  onEnded: (title: Title, episode: SelectedEpisode | null) => void;
  onView: (titleId: number) => void;
};

export default function DetailModal({
  selected, selectedEpisodeUrl, selectedEpisode, activePage, favorites,
  onClose, onSelectEpisode, onEditEpisode, onToggleFavorite, onProgress, onEnded, onView
}: DetailModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!selected) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = closeButtonRef.current?.closest('[role="dialog"]');
      const focusable = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), video[controls], [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [selected, onClose]);

  return (
    <AnimatePresence>
      {selected && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <motion.div className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title" initial={{ y: 18 }} animate={{ y: 0 }} exit={{ y: 10, opacity: 0 }}>
          <button ref={closeButtonRef} className="close-btn" type="button" aria-label="Fermer les détails" onClick={onClose}><X/></button>
          {(selectedEpisodeUrl || selected.videoUrl) ? <VideoPlayer
            key={selectedEpisodeUrl || selected.videoUrl}
            src={selectedEpisodeUrl || selected.videoUrl!}
            resumeAt={selectedEpisode
              ? selected.seasons?.find(season => season.number === selectedEpisode.season)?.episodes.find(episode => episode.number === selectedEpisode.episode)?.currentTime ?? 0
              : selected.currentTime ?? 0}
            onProgress={(second, progress) => onProgress(selected.id, selectedEpisode, second, progress)}
            onEnded={() => onEnded(selected, selectedEpisode)}
            onView={() => onView(selected.id)}
          /> : <div className="detail-backdrop" style={{ backgroundImage: `linear-gradient(0deg,#111318 0%,transparent 100%),url("${selected.backdrop}")` }}/>}
          <div className="detail-copy">
            <div className="eyebrow">{selected.kind.toUpperCase()} · {selected.year} · {selected.genre.toUpperCase()}</div>
            <h2 id="detail-modal-title">{selected.name}</h2>
            <div className="detail-facts"><span>{selected.duration}</span>{selected.episodes && <span>{selected.episodes}</span>}</div>
            <p>{selected.description}</p>
            {selected.seasons?.map((season) => <section className="episode-panel" key={season.number}>
              <h3>Saison {season.number}</h3>
              <div className="episode-list">{season.episodes.map((episode) => <div className="episode-line" key={episode.number}>
                <button className={`episode-row ${selectedEpisode?.season === season.number && selectedEpisode?.episode === episode.number ? "episode-active" : ""}`} type="button" disabled={!episode.videoUrl} onClick={() => onSelectEpisode(season.number, episode.number, episode.videoUrl || "")}>
                  {episode.thumbnailUrl ? <img className="episode-thumbnail" src={episode.thumbnailUrl} alt="" /> : <span className="episode-number">{String(episode.number).padStart(2, "0")}</span>}
                  <span className="episode-title-wrap"><span>{episode.title}</span>{(episode.progress || 0) > 0 && <i className="episode-progress"><b style={{ width: `${episode.progress}%` }}/></i>}</span>
                  <small>{episode.videoUrl ? ((episode.progress || 0) >= 100 ? "Terminé" : episode.progress ? `${episode.progress}% · reprendre` : "Lire") : "Vidéo absente"}</small>
                </button>
                {activePage === "Administration" && <button className="episode-edit" title="Modifier cet épisode" aria-label={`Modifier ${episode.title}`} onClick={() => onEditEpisode(season.number, episode.number, episode.title)}><Settings size={13}/></button>}
              </div>)}</div>
            </section>)}
            <div className="detail-actions">
              {selected.videoUrl ? <span className="available"><Play size={14}/> Vidéo locale prête à lire</span> : <span className="unavailable">Fichier vidéo non associé</span>}
              <button className={`outline-btn ${favorites.includes(selected.id) ? "is-fav" : ""}`} onClick={() => onToggleFavorite(selected.id)}><Heart size={15}/> {favorites.includes(selected.id) ? "Dans ma liste" : "Ajouter à ma liste"}</button>
            </div>
          </div>
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  );
}
