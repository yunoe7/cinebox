"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Image as ImageIcon, Upload } from "lucide-react";
import type { Title } from "../../lib/cinebox/types";
import { createBlobUrlLease, retainBlobUrl } from "../../lib/cinebox/blob-url-manager.mjs";
import type { BlobUrlLease } from "../../lib/cinebox/blob-url-manager.mjs";

export type EpisodeEditTarget = { season: number; episode: number; title: string };

type EpisodeEditorProps = {
  selected: Title | null;
  editingEpisode: EpisodeEditTarget | null;
  onClose: () => void;
  onSave: (target: EpisodeEditTarget, file?: File, thumbnail?: File) => Promise<void>;
};

export default function EpisodeEditor({ selected, editingEpisode, onClose, onSave }: EpisodeEditorProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<BlobUrlLease | null>(null);
  const thumbnailPreviewUrl = thumbnailPreview?.url || "";
  const [thumbnailError, setThumbnailError] = useState("");
  useEffect(() => () => thumbnailPreview?.release(), [thumbnailPreview]);
  const currentThumbnail = selected?.seasons?.find((season) => season.number === editingEpisode?.season)?.episodes.find((episode) => episode.number === editingEpisode?.episode)?.thumbnailUrl;
  useEffect(() => {
    if (!currentThumbnail?.startsWith("blob:")) return;
    const lease = retainBlobUrl(currentThumbnail);
    return () => lease.release();
  }, [currentThumbnail]);
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
          const thumbnail = (event.currentTarget.elements.namedItem("episodeThumbnail") as HTMLInputElement)?.files?.[0];
          if (thumbnail) {
            const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
            const extension = thumbnail.name.split(".").pop()?.toLocaleLowerCase("fr");
            const supportedExtensions = ["jpg", "jpeg", "png", "webp"];
            if ((!supportedTypes.includes(thumbnail.type) && !(thumbnail.type === "" && supportedExtensions.includes(extension || ""))) || thumbnail.size > 20 * 1024 * 1024) {
              setThumbnailError(thumbnail.size > 20 * 1024 * 1024 ? "L’image dépasse la limite de 20 Mo." : "Utilisez une image JPG, PNG ou WebP.");
              return;
            }
          }
          setThumbnailError("");
          await onSave({ ...editingEpisode, title }, file, thumbnail);
        }}>
        <div className="eyebrow">SAISON {editingEpisode.season} · ÉPISODE {editingEpisode.episode}</div>
        <h2 id="episode-editor-heading">Modifier l’épisode</h2>
        <label htmlFor="episode-title-input">Titre de l’épisode<input ref={titleInputRef} id="episode-title-input" name="episodeTitle" defaultValue={editingEpisode.title} autoFocus/></label>
        <label className="episode-file-label" htmlFor="episode-video-input">Remplacer la vidéo <input id="episode-video-input" name="episodeFile" type="file" accept="video/*"/></label>
        <label className="episode-file-label admin-episode-thumbnail-label" htmlFor="episode-thumbnail-input"><ImageIcon size={16}/> Miniature JPG, PNG ou WebP (20 Mo max)<input id="episode-thumbnail-input" name="episodeThumbnail" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const image = event.currentTarget.files?.[0]; setThumbnailError(""); setThumbnailPreview(image ? createBlobUrlLease(image) : null); }}/></label>
        {(thumbnailPreviewUrl || currentThumbnail) && <div className="admin-episode-thumbnail-preview"><img src={thumbnailPreviewUrl || currentThumbnail} alt="Aperçu de la miniature d’épisode"/><span>{thumbnailPreviewUrl ? "Nouvelle miniature" : "Miniature actuelle"}</span></div>}
        {thumbnailError && <p className="admin-media-validation-error" role="alert">{thumbnailError}</p>}
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onClose}>Annuler</button>
          <button type="submit" className="confirm-delete">Enregistrer</button>
        </div>
      </motion.form>
    </motion.div>
  );
}
