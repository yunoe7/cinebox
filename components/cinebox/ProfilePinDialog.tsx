"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { ProfileAvatar } from "./ProfileAvatar";
import { useModalDialog } from "./useModalDialog";
import {
  profilePinLockoutLabel,
  readProfilePinGuard,
  verifyProfilePinGuarded,
} from "../../lib/cinebox/profile-pin-guard.mjs";
import type { Profile } from "../../lib/cinebox/profiles.mjs";

export type ProfilePinAction = "activate" | "edit" | "make-primary" | "delete";

const ACTION_LABELS: Record<ProfilePinAction, string> = {
  activate: "ouvrir ce profil",
  edit: "modifier ce profil",
  "make-primary": "définir ce profil comme principal",
  delete: "supprimer ce profil",
};

function profileStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function ProfilePinDialog({ profile, action, onCancel, onVerified }: {
  profile: Profile;
  action: ProfilePinAction;
  onCancel: () => void;
  onVerified: () => void | Promise<void>;
}) {
  const headingId = useId();
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => {
    const state = readProfilePinGuard(profileStorage(), profile.id);
    return state.locked
      ? `Trop de tentatives. Réessayez dans ${profilePinLockoutLabel(state.retryAfterMs)}.`
      : "";
  });
  const reducedMotion = useReducedMotion();
  const { ref, dialogProps } = useModalDialog<HTMLFormElement>({
    onClose: onCancel,
    initialFocusRef: inputRef,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{4,8}$/.test(pin)) {
      setError("Le code PIN doit contenir de 4 à 8 chiffres.");
      return;
    }
    setBusy(true);
    try {
      const result = await verifyProfilePinGuarded(pin, profile.pin, {
        storage: profileStorage(),
        profileId: profile.id,
      });
      if (result.status === "ok") {
        setPin("");
        setError("");
        await onVerified();
        return;
      }
      setPin("");
      if (result.status === "locked") {
        setError(`Trop de tentatives. Réessayez dans ${profilePinLockoutLabel(result.state.retryAfterMs)}.`);
      } else if (result.status === "invalid-format") {
        setError("Le code PIN doit contenir de 4 à 8 chiffres.");
      } else if (result.status === "unavailable") {
        setError("La vérification du code PIN est momentanément indisponible. Réessayez sans risque de verrouillage.");
      } else {
        const remaining = result.state.remainingAttempts;
        setError(remaining > 0
          ? `Code PIN incorrect. ${remaining} tentative${remaining === 1 ? "" : "s"} restante${remaining === 1 ? "" : "s"}.`
          : "Code PIN incorrect.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="profile-form-backdrop"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reducedMotion ? undefined : { opacity: 0 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <motion.form
        ref={ref}
        {...dialogProps}
        aria-labelledby={headingId}
        aria-describedby={helpId}
        aria-busy={busy}
        className="profile-pin-dialog"
        onSubmit={submit}
        initial={reducedMotion ? false : { opacity: 0, y: 10, scale: .985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: 8 }}
      >
        <div className="profile-pin-dialog-head">
          <span className="profile-pin-dialog-icon" aria-hidden="true"><LockKeyhole size={19} /></span>
          <div className="profile-pin-dialog-heading">
            <span className="eyebrow">ACCÈS PROTÉGÉ</span>
            <h2 id={headingId}>Profil protégé</h2>
          </div>
        </div>
        <p id={helpId} className="profile-pin-dialog-help">Saisissez le code PIN de « {profile.name} » pour {ACTION_LABELS[action]}.</p>
        <div className="profile-pin-dialog-profile">
          <ProfileAvatar avatarId={profile.avatarId} size={40} />
          <div className="profile-pin-dialog-profile-copy"><strong>{profile.name}</strong><small>{profile.isChild ? "Profil enfant" : profile.isPrimary ? "Profil principal" : "Profil"}</small></div>
          <span className="profile-pin-dialog-badge"><LockKeyhole size={11} /> Code PIN</span>
        </div>
        <label className="profile-pin-dialog-label" htmlFor="profile-pin-dialog-input">Code PIN</label>
        <div className={`profile-pin-dialog-field${error ? " is-invalid" : ""}`}>
          <span className="profile-pin-dialog-field-icon" aria-hidden="true"><LockKeyhole size={15} /></span>
          <input
            ref={inputRef}
            id="profile-pin-dialog-input"
            className="profile-pin-dialog-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${helpId} profile-pin-dialog-error` : helpId}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            placeholder="4 à 8 chiffres"
          />
          <span className="profile-pin-dialog-count" aria-hidden="true">{pin.length}/8</span>
        </div>
        {error && <p id="profile-pin-dialog-error" className="profile-pin-dialog-error" role="alert"><ShieldAlert size={14} /> <span>{error}</span></p>}
        <div className="profile-pin-dialog-actions">
          <button type="button" className="profile-secondary-action" onClick={onCancel}>Annuler</button>
          <button type="submit" className="profile-gold-action" disabled={busy}>{busy ? "Vérification…" : "Continuer"}</button>
        </div>
      </motion.form>
    </motion.div>
  );
}
