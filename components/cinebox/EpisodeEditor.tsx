"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { Title } from "../../lib/cinebox/types";

export type EpisodeEditTarget = { season: number; episode: number; title: string };

type EpisodeEditorProps = {
  selected: Title | null;
  editingEpisode: EpisodeEditTarget | null;
  onClose: () => void;
  onSave: (target: EpisodeEditTarget, file?: File) => Promise<void>;
};

export default function EpisodeEditor({ selected, editingEpisode, onClose, onSave }: EpisodeEditorProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!selected || !editingEpisode) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleInputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const dialog = titleInputRef.current?.closest('[role="dialog"]');
      const items = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { window.removeEventListener("keydown", handleKeyDown); previous?.focus(); };
  }, [selected, editingEpisode, onClose]);
  if (!selected || !editingEpisode) return null;

  return (
    <motion.div className="modal-backdrop episode-edit-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.form className="episode-edit-modal" role="dialog" aria-modal="true" aria-labelledby="episode-editor-heading" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const title = String(form.get("episodeTitle") || "").trim() || `Épisode ${editingEpisode.episode}`;
          const file = (event.currentTarget.elements.namedItem("episodeFile") as HTMLInputElement)?.files?.[0];
          await onSave({ ...editingEpisode, title }, file);
        }}>
        <div className="eyebrow">SAISON {editingEpisode.season} · ÉPISODE {editingEpisode.episode}</div>
        <h2 id="episode-editor-heading">Modifier l’épisode</h2>
        <label htmlFor="episode-title-input">Titre de l’épisode<input ref={titleInputRef} id="episode-title-input" name="episodeTitle" defaultValue={editingEpisode.title} autoFocus/></label>
        <label className="episode-file-label" htmlFor="episode-video-input">Remplacer la vidéo <input id="episode-video-input" name="episodeFile" type="file" accept="video/*"/></label>
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onClose}>Annuler</button>
          <button type="submit" className="confirm-delete">Enregistrer</button>
        </div>
      </motion.form>
    </motion.div>
  );
}
