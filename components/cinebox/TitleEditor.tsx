"use client";

import { motion } from "framer-motion";
import { ChevronRight, Star, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RefObject, FormEvent } from "react";
import type { Kind, Title } from "../../lib/cinebox/types";
import { SmartImport, type SmartImportData, type SmartImportedAsset } from "./SmartImport";
import { createBlobUrlLease, retainBlobUrl } from "../../lib/cinebox/blob-url-manager.mjs";
import type { BlobUrlLease } from "../../lib/cinebox/blob-url-manager.mjs";
import { BlurFade } from "../magicui/blur-fade";

type Props = {
  addKind: Kind;
  setAddKind: (kind: Kind) => void;
  editingTitle: Title | null;
  existingTitles: Title[];
  setEditingTitle: (title: Title | null) => void;
  adminMode?: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  posterRef: RefObject<HTMLInputElement | null>;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export default function TitleEditor({ addKind, setAddKind, editingTitle, existingTitles, setEditingTitle, adminMode = false, fileRef, posterRef, submitting = false, onClose, onSubmit }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [posterPreview, setPosterPreview] = useState<BlobUrlLease | null>(null);
  const [smartPayload, setSmartPayload] = useState<SmartImportData | null>(null);
  const [smartAssets, setSmartAssets] = useState<SmartImportedAsset[]>([]);
  const [smartPoster, setSmartPoster] = useState<File | null>(null);
  const posterPreviewUrl = posterPreview?.url || "";
  useEffect(() => {
    if (!smartPayload) return;
    const form = document.querySelector<HTMLFormElement>(".add-form");
    const setField = (name: string, value: string) => {
      const field = form?.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    setField("name", smartPayload.name);
    setField("year", smartPayload.releaseDate.slice(0, 4));
    setField("genre", smartPayload.genres.join(", "));
    setField("description", smartPayload.description);
    if (smartPayload.runtime) setField("duration", `${smartPayload.runtime} min`);
    if (smartPayload.seasons?.length) {
      setField("seasonCount", String(Math.max(...smartPayload.seasons.map(season => season.number))));
      setField("episodeCount", String(Math.max(0, ...smartPayload.seasons.map(season => season.episodes.length))));
      setField("episodeTitles", smartPayload.seasons.flatMap(season => season.episodes.map(episode => episode.title)).join("\n"));
    }
    if (posterRef.current) {
      posterRef.current.value = "";
      if (smartPoster) {
        const transfer = new DataTransfer();
        transfer.items.add(smartPoster);
        posterRef.current.files = transfer.files;
      }
      posterRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, [smartPayload?.tmdbId]);
  useEffect(() => () => posterPreview?.release(), [posterPreview]);
  useEffect(() => {
    if (!editingTitle?.poster?.startsWith("blob:")) return;
    const lease = retainBlobUrl(editingTitle.poster);
    return () => lease.release();
  }, [editingTitle?.poster]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const dialog = closeButtonRef.current?.closest('[role="dialog"]');
      const items = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { window.removeEventListener("keydown", handleKeyDown); previous?.focus(); };
  }, [onClose]);
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div className="modal add-modal" role="dialog" aria-modal="true" aria-labelledby="title-editor-heading" initial={{ y: 18, scale: .99 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, opacity: 0 }}>
        <button className="close-btn" type="button" aria-label="Fermer le formulaire" onClick={onClose} ref={closeButtonRef}><X/></button>
        <div className="eyebrow">{editingTitle ? "MODIFIER LA BIBLIOTHÈQUE" : "BIBLIOTHÈQUE PERSONNELLE"}</div>
        <h2 id="title-editor-heading">{editingTitle ? "Modifier le " : "Ajouter un "}<em>titre</em></h2>
        <p className="modal-desc">{editingTitle ? "Mettez à jour les informations de ce contenu." : "Renseignez les informations essentielles, puis ajoutez vos médias."}</p>
        <form className="add-form" onSubmit={onSubmit}>
          <BlurFade className="title-editor-zone title-editor-zone-search" duration={0.35} delay={0}>
            <div className="title-editor-zone-head"><span className="eyebrow">A · RECHERCHER</span><h3>Importer depuis TMDB</h3><p>Recherchez un film ou une série, puis laissez CinéBox préremplir la fiche.</p></div>
            <SmartImport addKind={addKind} existingTitles={existingTitles} onDuplicate={title => setEditingTitle(title)} onApply={(data, poster, assets) => {
              setSmartPayload(data);
              setSmartAssets(assets);
              setSmartPoster(poster);
              setAddKind(data.kind);
            }}/>
            {smartPayload && <fieldset className="smart-import-metadata"><legend>Métadonnées reconnues · modifiables</legend>
              <div className="form-row"><label>Titre original<input value={smartPayload.originalName} onChange={event => setSmartPayload({ ...smartPayload, originalName: event.target.value })}/></label><label>Date de sortie<input type="date" value={smartPayload.releaseDate} onChange={event => setSmartPayload({ ...smartPayload, releaseDate: event.target.value })}/></label></div>
              <div className="form-row"><label>Langue originale<input value={smartPayload.originalLanguage} onChange={event => setSmartPayload({ ...smartPayload, originalLanguage: event.target.value })}/></label><label>Réalisateur<input value={smartPayload.director} onChange={event => setSmartPayload({ ...smartPayload, director: event.target.value })}/></label></div>
              <label>Distribution principale<input value={smartPayload.cast.join(", ")} onChange={event => setSmartPayload({ ...smartPayload, cast: event.target.value.split(",").map(value => value.trim()).filter(Boolean) })}/></label>
              <label>Pays de production<input value={smartPayload.productionCountries.join(", ")} onChange={event => setSmartPayload({ ...smartPayload, productionCountries: event.target.value.split(",").map(value => value.trim()).filter(Boolean) })}/></label>
              <div className="form-row"><label>Note TMDB<input type="number" min="0" max="10" step="any" value={smartPayload.rating} onChange={event => setSmartPayload({ ...smartPayload, rating: Number(event.target.value) })}/></label><label>Votes<input type="number" min="0" step="1" value={smartPayload.voteCount} onChange={event => setSmartPayload({ ...smartPayload, voteCount: Number(event.target.value) })}/></label></div>
              <label>Statut de diffusion<input value={smartPayload.status || ""} onChange={event => setSmartPayload({ ...smartPayload, status: event.target.value })}/></label>
              <small>TMDB #{smartPayload.tmdbId} · <Star size={11} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 2 }} /> {smartPayload.rating} ({smartPayload.voteCount} votes){smartPayload.productionCountries.length ? ` · ${smartPayload.productionCountries.join(", ")}` : ""}{smartPayload.status ? ` · ${smartPayload.status}` : ""}</small>
            </fieldset>}
            {smartAssets.map(({ slot, file }) => <input key={slot} type="file" hidden name={`smartAsset:${slot}`} ref={element => {
              if (!element) return;
              const transfer = new DataTransfer();
              transfer.items.add(file);
              element.files = transfer.files;
            }}/>) }
            <input type="hidden" name="smartImport" value={smartPayload ? JSON.stringify(smartPayload) : ""}/>
          </BlurFade>
          <BlurFade className="title-editor-zone title-editor-zone-details" duration={0.35} delay={0.05}>
            <div className="title-editor-zone-head"><span className="eyebrow">B · PERSONNALISER</span><h3>Informations du titre</h3><p>Modifiez les données récupérées ou renseignez manuellement la fiche.</p></div>
            <div className="title-editor-details-layout">
              <div className="title-editor-poster-preview">
                {posterPreviewUrl || editingTitle?.poster ? <img src={posterPreviewUrl || editingTitle?.poster} alt="Aperçu de l'affiche"/> : <span className="title-editor-poster-empty"><Upload size={20}/> Aucune affiche</span>}
              </div>
              <div className="title-editor-fields">
                <label>Titre<input name="name" required placeholder="Ex. Le voyage intérieur" defaultValue={editingTitle?.name || ""}/></label>
                <div className="form-row"><label>Type<select name="kind" value={addKind} onChange={(e) => setAddKind(e.target.value as Kind)}><option>Film</option><option>Série</option><option>Vidéo</option></select></label><label>Année<input name="year" type="number" min="1900" max="2099" defaultValue={editingTitle?.year || 2026}/></label></div>
                <div className="form-row"><label>Genre<input name="genre" placeholder="Drame, aventure…" defaultValue={editingTitle?.genre || ""}/></label><label>Durée<input name="duration" placeholder="1 h 45, 42 min…" defaultValue={editingTitle?.duration || ""}/></label></div>
                <label>Collection ou saga <small className="field-hint">Facultatif · Ex. Harry Potter, Marvel, Star Wars</small><input name="collection" placeholder="Nom de la collection…" defaultValue={editingTitle?.collection || ""}/></label>
                {addKind === "Série" && <><div className="form-row"><label>Nombre de saisons<input name="seasonCount" type="number" min="1" max="20" placeholder="1" defaultValue={editingTitle?.seasons?.length || 1}/></label><label>Épisodes par saison<input name="episodeCount" type="number" min="1" placeholder="8" defaultValue={editingTitle?.seasons?.[0]?.episodes.length || ""}/></label></div>
                <label>Titres des épisodes (un par ligne)<textarea name="episodeTitles" rows={3} placeholder={"Épisode 1 — Le début\nÉpisode 2 — La suite"} defaultValue={editingTitle?.seasons?.flatMap(season => season.episodes.map(episode => episode.title)).join("\n") || ""}/></label>
                {editingTitle?.seasons?.some(season => season.episodes.length) && <details>
                  <summary>Supprimer explicitement des épisodes</summary>
                  {editingTitle.seasons.flatMap(season => season.episodes.map(episode => <label key={`${season.number}:${episode.number}`}>
                    <input type="checkbox" name="removeEpisode" value={`${season.number}:${episode.number}`}/>
                    Supprimer Saison {season.number}, épisode {episode.number} — {episode.title}
                  </label>))}
                </details>}
                <label className="upload-field"><Upload size={16}/><span>Vidéos des épisodes <small>Sélectionnez plusieurs fichiers dans l’ordre des épisodes</small></span><input name="episodeVideos" type="file" accept="video/*" multiple/></label></>}
                <label>Résumé<textarea name="description" rows={3} placeholder="Quelques mots sur ce titre…" defaultValue={editingTitle?.description || ""}/></label>
              </div>
            </div>
          </BlurFade>
          <BlurFade className="title-editor-zone title-editor-zone-media" duration={0.35} delay={0.1}>
            <div className="title-editor-zone-head"><span className="eyebrow">C · MÉDIAS & VALIDATION</span><h3>Affiche et vidéo</h3><p>Ajoutez vos fichiers et validez la fiche.</p></div>
            <label className="upload-field"><Upload size={16}/><span>{adminMode && addKind === "Vidéo" ? "Miniature vidéo" : "Affiche du titre"} <small>{adminMode ? "JPG, PNG ou WebP · 20 Mo maximum" : "Image JPG, PNG ou WebP depuis votre appareil"}</small></span><input ref={posterRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={adminMode ? (event) => setPosterPreview(event.currentTarget.files?.[0] ? createBlobUrlLease(event.currentTarget.files[0]) : null) : undefined}/></label>
            {adminMode && (posterPreviewUrl || editingTitle?.poster) && <div className="admin-editor-image-preview"><img src={posterPreviewUrl || editingTitle?.poster} alt="Aperçu de l'affiche sélectionnée"/><span>{posterPreviewUrl ? "Aperçu de la nouvelle image" : "Image actuelle"}</span></div>}
            {addKind !== "Série" && <label className="upload-field"><Upload size={16}/><span>Fichier vidéo <small>Facultatif · MP4, WebM et formats pris en charge</small></span><input ref={fileRef} type="file" accept="video/*"/></label>}
            <button className="gold-btn full" type="submit" disabled={submitting} aria-busy={submitting}>{submitting ? "Enregistrement…" : (editingTitle ? "Enregistrer les modifications" : "Ajouter à ma collection")} <ChevronRight size={16}/></button>
          </BlurFade>
        </form>
        <p className="local-note">Les titres, affiches et vidéos sont conservés dans le stockage de ce navigateur. Ils ne sont pas encore synchronisés entre appareils.</p>
      </motion.div>
    </motion.div>
  );
}