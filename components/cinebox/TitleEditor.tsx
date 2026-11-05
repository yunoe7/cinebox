"use client";

import { motion } from "framer-motion";
import { ChevronRight, Upload, X } from "lucide-react";
import type { RefObject, FormEvent } from "react";
import type { Kind, Title } from "../../lib/cinebox/types";

type Props = {
  addKind: Kind;
  setAddKind: (kind: Kind) => void;
  editingTitle: Title | null;
  fileRef: RefObject<HTMLInputElement | null>;
  posterRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export default function TitleEditor({ addKind, setAddKind, editingTitle, fileRef, posterRef, onClose, onSubmit }: Props) {
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div className="modal add-modal" initial={{ y: 18, scale: .99 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, opacity: 0 }}>
        <button className="close-btn" onClick={onClose}><X/></button>
        <div className="eyebrow">{editingTitle ? "MODIFIER LA BIBLIOTHÈQUE" : "BIBLIOTHÈQUE PERSONNELLE"}</div>
        <h2>{editingTitle ? "Modifier le " : "Ajouter un "}<em>titre</em></h2>
        <p className="modal-desc">{editingTitle ? "Mettez à jour les informations de ce contenu." : "Renseignez les informations essentielles, puis ajoutez vos médias."}</p>
        <form className="add-form" onSubmit={onSubmit}>
          <label>Titre<input name="name" required placeholder="Ex. Le voyage intérieur" defaultValue={editingTitle?.name || ""}/></label>
          <div className="form-row"><label>Type<select name="kind" value={addKind} onChange={(e) => setAddKind(e.target.value as Kind)}><option>Film</option><option>Série</option><option>Vidéo</option></select></label><label>Année<input name="year" type="number" min="1900" max="2099" defaultValue={editingTitle?.year || 2026}/></label></div>
          <div className="form-row"><label>Genre<input name="genre" placeholder="Drame, aventure…" defaultValue={editingTitle?.genre || ""}/></label><label>Durée<input name="duration" placeholder="1 h 45, 42 min…" defaultValue={editingTitle?.duration || ""}/></label></div>
          {addKind === "Série" && <><div className="form-row"><label>Nombre de saisons<input name="seasonCount" type="number" min="1" max="20" placeholder="1" defaultValue={editingTitle?.seasons?.length || 1}/></label><label>Épisodes par saison<input name="episodeCount" type="number" min="1" placeholder="8" defaultValue={editingTitle?.seasons?.[0]?.episodes.length || ""}/></label></div>
          <label>Titres des épisodes (un par ligne)<textarea name="episodeTitles" rows={3} placeholder={"Épisode 1 — Le début\nÉpisode 2 — La suite"} defaultValue={editingTitle?.seasons?.flatMap(season => season.episodes.map(episode => episode.title)).join("\n") || ""}/></label>
          <label className="upload-field"><Upload size={16}/><span>Vidéos des épisodes <small>Sélectionnez plusieurs fichiers dans l’ordre des épisodes</small></span><input name="episodeVideos" type="file" accept="video/*" multiple/></label></>}
          <label>Résumé<textarea name="description" rows={3} placeholder="Quelques mots sur ce titre…" defaultValue={editingTitle?.description || ""}/></label>
          <label className="upload-field"><Upload size={16}/><span>Affiche du titre <small>Image JPG, PNG ou WebP depuis votre appareil</small></span><input ref={posterRef} type="file" accept="image/png,image/jpeg,image/webp"/></label>
          {addKind !== "Série" && <label className="upload-field"><Upload size={16}/><span>Fichier vidéo <small>Facultatif · MP4, WebM et formats pris en charge</small></span><input ref={fileRef} type="file" accept="video/*"/></label>}
          <button className="gold-btn full" type="submit">{editingTitle ? "Enregistrer les modifications" : "Ajouter à ma collection"} <ChevronRight size={16}/></button>
        </form>
        <p className="local-note">Les titres, affiches et vidéos sont conservés dans le stockage de ce navigateur. Ils ne sont pas encore synchronisés entre appareils.</p>
      </motion.div>
    </motion.div>
  );
}
