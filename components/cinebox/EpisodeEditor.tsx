"use client";

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
        <label htmlFor="episode-title-input">Titre de l’épisode<input id="episode-title-input" name="episodeTitle" defaultValue={editingEpisode.title} autoFocus/></label>
        <label className="episode-file-label" htmlFor="episode-video-input">Remplacer la vidéo <input id="episode-video-input" name="episodeFile" type="file" accept="video/*"/></label>
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onClose}>Annuler</button>
          <button type="submit" className="confirm-delete">Enregistrer</button>
        </div>
      </motion.form>
    </motion.div>
  );
}
