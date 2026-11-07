"use client";

import { useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronLeft, LockKeyhole, Plus, Search, Settings, ShieldAlert, ShieldCheck, Star, Trash2, X } from "lucide-react";
import { BlurFade } from "../magicui/blur-fade";
import { MagicCard } from "../magicui/magic-card";
import { ShimmerButton } from "../magicui/shimmer-button";
import { createProfile, deleteProfile, setPrimaryProfile, updateProfile, updateProfileData } from "../../lib/cinebox/profiles.mjs";
import { hashProfilePin, verifyProfilePin } from "../../lib/cinebox/profile-pin.mjs";
import type { Profile, ProfileStore } from "../../lib/cinebox/profiles.mjs";
import { avatarCategories, profileAvatars, ProfileAvatar } from "./ProfileAvatar";
import { CineboxLogo } from "./CineboxLogo";

type EditorDraft = { id?: string; name: string; avatarId: string; isChild: boolean; pin: string; confirmPin: string; clearPin: boolean; autoplayNext: boolean };
const blankDraft: EditorDraft = { name: "", avatarId: "golden-reel", isChild: false, pin: "", confirmPin: "", clearPin: false, autoplayNext: true };

export function ProfileCenter({ store, initialMode = "gate", onClose, onCommit, onActivate, isChildSession = false }: {
  store: ProfileStore;
  initialMode?: "gate" | "manage";
  onClose?: () => void;
  onCommit: (next: ProfileStore) => Promise<boolean>;
  onActivate: (profileId: string) => Promise<void> | void;
  isChildSession?: boolean;
}) {
  const [mode, setMode] = useState<"gate" | "manage">(initialMode);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [avatarSearch, setAvatarSearch] = useState("");
  const [avatarCategory, setAvatarCategory] = useState<string>("Tout");
  const [notice, setNotice] = useState("");
  const reducedMotion = useReducedMotion();
  const filteredAvatars = useMemo(() => profileAvatars.filter((avatar) =>
    (avatarCategory === "Tout" || avatar.category === avatarCategory) &&
    `${avatar.name} ${avatar.category}`.toLocaleLowerCase("fr").includes(avatarSearch.toLocaleLowerCase("fr"))), [avatarCategory, avatarSearch]);

  const enterProfile = async (profile: Profile, code = "") => {
    if (profile.pin && !await verifyProfilePin(code, profile.pin)) {
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      setPinError(nextAttempts >= 5 ? "Trop de tentatives. Rechargez la page pour réessayer." : "Code PIN incorrect.");
      return;
    }
    setPinError("");
    await onActivate(profile.id);
  };

  const startEdit = (profile?: Profile) => {
    if (isChildSession) { setNotice("La gestion des profils est indisponible dans un profil enfant."); return; }
    setNotice("");
    setAvatarSearch("");
    setAvatarCategory("Tout");
    setDraft(profile ? { id: profile.id, name: profile.name, avatarId: profile.avatarId, isChild: profile.isChild, pin: "", confirmPin: "", clearPin: false, autoplayNext: store.data[profile.id].preferences.autoplayNext } : { ...blankDraft });
  };

  const saveDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const name = draft.name.trim();
    if (!name || name.length > 24) { setNotice("Le nom doit contenir entre 1 et 24 caractères."); return; }
    if ((!draft.id || draft.pin || draft.confirmPin) && draft.pin !== draft.confirmPin) { setNotice("Les deux codes PIN doivent correspondre."); return; }
    let pinRecord = undefined;
    try {
      if (draft.clearPin) pinRecord = null;
      else if (draft.pin) pinRecord = await hashProfilePin(draft.pin);
      let next = draft.id
        ? updateProfile(store, draft.id, { name, avatarId: draft.avatarId, isChild: draft.isChild, ...(pinRecord !== undefined ? { pin: pinRecord } : {}) })
        : createProfile(store, { name, avatarId: draft.avatarId, isChild: draft.isChild, pin: pinRecord || null });
      const profileId = draft.id || next.profiles.at(-1)!.id;
      next = updateProfileData(next, profileId, (data) => ({ ...data, preferences: { ...data.preferences, autoplayNext: draft.autoplayNext } }));
      if (!await onCommit(next)) return;
      setDraft(null);
      setNotice(draft.id ? "Profil enregistré." : "Profil créé.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Le profil n’a pas pu être enregistré."); }
  };

  const makePrimary = async (profile: Profile) => {
    try {
      const next = setPrimaryProfile(store, profile.id);
      if (await onCommit(next)) setNotice(`« ${profile.name} » est maintenant le profil principal.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Le profil principal n’a pas été modifié."); }
  };

  const confirmRemove = async () => {
    if (!deleteTarget) return;
    try {
      const next = deleteProfile(store, deleteTarget.id);
      if (await onCommit(next)) { setNotice("Profil supprimé. Ses favoris et progressions ont été retirés avec lui."); setDeleteTarget(null); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Le profil n’a pas pu être supprimé."); }
  };

  const title = mode === "gate" ? "Qui regarde ?" : "Gérer les profils";
  const closeCenter = () => { setDraft(null); setDeleteTarget(null); if (initialMode === "gate") setMode("gate"); else onClose?.(); };

  const content = <section className={`profile-center ${mode === "gate" ? "profile-center-gate" : "profile-center-manager"}`} aria-label={title}>
    {mode !== "gate" && <div className="profile-center-topline"><span className="profile-center-brand"><i>C</i> CINÉBOX</span>{initialMode !== "gate" && <button className="profile-center-close" aria-label="Fermer la gestion des profils" onClick={closeCenter}><X size={18}/></button>}</div>}
    {mode === "gate" ? <BlurFade className="profile-center-inner" duration={reducedMotion ? 0 : .55}>
      <div className="profile-center-heading profile-center-heading--gate"><CineboxLogo variant="profile-gate"/><span className="eyebrow">VOTRE ESPACE PERSONNEL</span><h1>Qui regarde<em> ?</em></h1><p>Choisissez un profil pour retrouver votre cinéma.</p></div>
      <div className="profile-select-grid">
        {store.profiles.map((profile, index) => <BlurFade key={profile.id} delay={reducedMotion ? 0 : index * .045}>
          <MagicCard className="profile-select-card-wrap"><button type="button" className="profile-select-card" onClick={() => { setSelected(profile); setPin(""); setPinError(""); if (profile.pin) return; void enterProfile(profile); }} aria-label={`Choisir le profil ${profile.name}`}>
            <span className="profile-select-avatar-wrap"><ProfileAvatar avatarId={profile.avatarId}/>{profile.pin && <i className="profile-lock-mark"><LockKeyhole size={13}/></i>}</span>
            <strong>{profile.name}</strong><small>{profile.isChild ? "Profil enfant" : profile.isPrimary ? "Profil principal" : "Profil"}</small>
          </button></MagicCard>
        </BlurFade>)}
        {!isChildSession && store.profiles.length < 8 && <button type="button" className="profile-add-card" onClick={() => setMode("manage")}><span><Plus size={22}/></span><strong>Ajouter un profil</strong></button>}
      </div>
      {selected?.pin && <form className="profile-pin-panel" onSubmit={(event) => { event.preventDefault(); if (attempts < 5) void enterProfile(selected, pin); }}>
        <ProfileAvatar avatarId={selected.avatarId} size={36}/><div><strong>{selected.name}</strong><small>Ce profil est protégé par un code PIN.</small></div>
        <label className="sr-only" htmlFor="profile-entry-pin">Code PIN</label><input id="profile-entry-pin" type="password" autoComplete="off" inputMode="numeric" pattern="[0-9]*" maxLength={8} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="Code PIN" autoFocus/>
        <ShimmerButton className="profile-gold-action" type="submit" disabled={attempts >= 5}>Continuer</ShimmerButton>
        {pinError && <p role="alert">{pinError}</p>}
      </form>}
      <div className="profile-center-footer"><button type="button" onClick={() => setMode("manage")} disabled={isChildSession}><Settings size={14}/> Gérer les profils</button><span>Bibliothèque et médias partagés sur cet appareil</span></div>
    </BlurFade> : <div className="profile-manager-inner">
      <div className="profile-manager-heading"><div><span className="eyebrow">IDENTITÉS CINÉBOX</span><h1>Gérer les profils</h1><p>Chaque profil garde ses favoris et sa lecture à part.</p></div><button className="profile-manager-back" type="button" onClick={closeCenter}><ChevronLeft size={16}/>{initialMode === "gate" ? "Choisir un profil" : "Retour"}</button></div>
      {isChildSession && <div className="profile-child-lock-note" role="note"><ShieldAlert size={17}/> La gestion est limitée dans un profil enfant.</div>}
      <div className="profile-manager-list">
        {store.profiles.map((profile) => <MagicCard key={profile.id} className="profile-manager-card-wrap"><article className="profile-manager-card">
          <ProfileAvatar avatarId={profile.avatarId} size={58}/><div className="profile-manager-card-copy"><strong>{profile.name}</strong><small>{profile.isPrimary ? "Profil principal" : "Profil"}{profile.isChild ? " · Enfant" : ""}{profile.pin ? " · PIN" : ""}</small><small className="profile-data-caption">Données locales séparées</small></div>
          {!isChildSession && <div className="profile-manager-actions"><button type="button" onClick={() => void startEdit(profile)}>Modifier</button>{!profile.isPrimary && <button type="button" onClick={() => void makePrimary(profile)} aria-label={`Définir ${profile.name} comme profil principal`}><Star size={14}/> Principal</button>}{!profile.isPrimary && <button type="button" className="profile-danger-action" onClick={() => setDeleteTarget(profile)} aria-label={`Supprimer le profil ${profile.name}`}><Trash2 size={14}/></button>}</div>}
        </article></MagicCard>)}
      </div>
      {!isChildSession && store.profiles.length < 8 && <ShimmerButton className="profile-create-action" onClick={() => startEdit()}><Plus size={16}/> Ajouter un profil</ShimmerButton>}
      <div className="profile-security-note"><ShieldCheck size={16}/><p>Le code PIN est haché dans ce navigateur. CinéBox fonctionne localement : une personne ayant accès aux outils du navigateur peut contourner cette protection. Le mode enfant limite l’interface, mais ne remplace pas un contrôle parental sécurisé.</p></div>
      {notice && <p className="profile-status-message" role="status">{notice}</p>}
    </div>}

    <AnimatePresence>
      {draft && <motion.div className="profile-form-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}>
        <motion.form className="profile-editor-panel" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title" onSubmit={saveDraft} initial={reducedMotion ? false : { opacity: 0, y: 12, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reducedMotion ? undefined : { opacity: 0, y: 8 }}>
          <div className="profile-editor-heading"><div><span className="eyebrow">PERSONNALISATION</span><h2 id="profile-editor-title">{draft.id ? "Modifier le profil" : "Nouveau profil"}</h2></div><button type="button" className="profile-center-close" aria-label="Fermer l’éditeur" onClick={() => setDraft(null)}><X size={17}/></button></div>
          <div className="profile-editor-preview"><ProfileAvatar avatarId={draft.avatarId} size={70}/><div><strong>{draft.name || "Votre nom"}</strong><small>{draft.isChild ? "Profil enfant" : "Profil"}</small></div></div>
          <label className="profile-field-label" htmlFor="profile-name">Nom</label><input id="profile-name" className="profile-field-input" value={draft.name} maxLength={24} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required autoFocus/>
          <div className="profile-avatar-heading"><div><strong>Avatar</strong><small>Créations locales CinéBox, sans images distantes</small></div><label className="profile-avatar-search"><Search size={14}/><input aria-label="Rechercher un avatar" value={avatarSearch} onChange={(event) => setAvatarSearch(event.target.value)} placeholder="Rechercher"/></label></div>
          <div className="profile-avatar-categories" aria-label="Catégories d’avatars"><button type="button" className={avatarCategory === "Tout" ? "selected" : ""} onClick={() => setAvatarCategory("Tout")}>Tout</button>{avatarCategories.map((category) => <button key={category} type="button" className={avatarCategory === category ? "selected" : ""} onClick={() => setAvatarCategory(category)}>{category}</button>)}</div>
          <div className="profile-avatar-gallery" aria-label="Galerie des avatars">{filteredAvatars.map((avatar) => <button key={avatar.id} type="button" className={draft.avatarId === avatar.id ? "selected" : ""} aria-label={`Choisir l’avatar ${avatar.name}`} aria-pressed={draft.avatarId === avatar.id} onClick={() => setDraft({ ...draft, avatarId: avatar.id })}><ProfileAvatar avatarId={avatar.id}/><small>{avatar.name}</small>{draft.avatarId === avatar.id && <i><Check size={11}/></i>}</button>)}</div>
          <label className="profile-child-toggle"><input type="checkbox" checked={draft.isChild} onChange={(event) => setDraft({ ...draft, isChild: event.target.checked })}/><span><strong>Mode enfant</strong><small>Masque la gestion du catalogue sur ce profil. Le catalogue n’a pas de classification d’âge automatique.</small></span></label>
          <label className="profile-child-toggle profile-autoplay-toggle"><input type="checkbox" checked={draft.autoplayNext} onChange={(event) => setDraft({ ...draft, autoplayNext: event.target.checked })}/><span><strong>Lecture automatique de l’épisode suivant</strong><small>Préférence enregistrée séparément pour ce profil.</small></span></label>
          <div className="profile-pin-fields"><strong>Code PIN <small>facultatif</small></strong><input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} pattern="[0-9]{4,8}" value={draft.pin} onChange={(event) => setDraft({ ...draft, pin: event.target.value.replace(/\D/g, "") })} placeholder={draft.id ? "Nouveau code (4 à 8 chiffres)" : "4 à 8 chiffres"}/>{(draft.pin || !draft.id) && <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} pattern="[0-9]{4,8}" value={draft.confirmPin} onChange={(event) => setDraft({ ...draft, confirmPin: event.target.value.replace(/\D/g, "") })} placeholder="Confirmer le code"/>}{draft.id && <div className="profile-pin-actions">{store.profiles.find((profile) => profile.id === draft.id)?.pin && <small>Un PIN est actuellement défini.</small>}<label><input type="checkbox" checked={draft.clearPin} onChange={(event) => setDraft({ ...draft, clearPin: event.target.checked, pin: "", confirmPin: "" })}/> Supprimer le PIN</label></div>}</div>
          {notice && <p className="profile-status-message" role="alert">{notice}</p>}
          <div className="profile-editor-actions"><button type="button" className="profile-secondary-action" onClick={() => setDraft(null)}>Annuler</button><ShimmerButton className="profile-gold-action" type="submit"><Check size={15}/> Enregistrer</ShimmerButton></div>
        </motion.form>
      </motion.div>}
      {deleteTarget && <motion.div className="profile-form-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="profile-delete-panel" role="alertdialog" aria-modal="true" aria-labelledby="profile-delete-title" initial={reducedMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <span className="profile-delete-icon"><Trash2 size={19}/></span><h2 id="profile-delete-title">Supprimer « {deleteTarget.name} » ?</h2><p>Ses favoris, son historique et ses progressions seront retirés de ce profil. Les titres et les médias partagés resteront dans la bibliothèque.</p><div><button type="button" className="profile-secondary-action" onClick={() => setDeleteTarget(null)}>Garder le profil</button><button type="button" className="profile-confirm-delete" onClick={() => void confirmRemove()}>Supprimer le profil</button></div>
      </motion.div></motion.div>}
    </AnimatePresence>
  </section>;

  return mode === "gate" && initialMode === "gate"
    ? <main className="profile-gate-screen">{content}</main>
    : <div className="profile-center-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCenter(); }}><div className="profile-center-modal">{content}</div></div>;
}

