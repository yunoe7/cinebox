"use client";

import type { FormEvent, ReactNode } from "react";
import { LoaderCircle, LogOut, ShieldCheck } from "lucide-react";

export type AdminAuthState = "checking" | "anonymous" | "authenticated";

type AdminSessionPanelProps = {
  authState: AdminAuthState;
  password: string;
  loggingIn: boolean;
  onPasswordChange: (value: string) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onLogout: () => void;
  description: string;
  status?: ReactNode;
  className?: string;
};

/**
 * Compact, shared administrator session panel.
 *
 * It only renders the existing client session primitives: the actual password
 * check, cookie handling and server-side authorisation stay unchanged.
 */
export function AdminSessionPanel({
  authState,
  password,
  loggingIn,
  onPasswordChange,
  onLogin,
  onLogout,
  description,
  status,
  className = "",
}: AdminSessionPanelProps) {
  if (authState === "checking") {
    return (
      <div className={`admin-session-panel is-checking ${className}`.trim()} role="status">
        <span className="admin-session-icon" aria-hidden="true"><LoaderCircle size={15} className="admin-spin" /></span>
        <div className="admin-session-copy">
          <strong>Vérification de la session…</strong>
          <span>CinéBox vérifie la session administrateur auprès du serveur.</span>
        </div>
      </div>
    );
  }

  if (authState === "authenticated") {
    return (
      <div className={`admin-session-panel is-authenticated ${className}`.trim()}>
        <span className="admin-session-icon" aria-hidden="true"><ShieldCheck size={15} /></span>
        <div className="admin-session-copy">
          <strong>Session administrateur active</strong>
          {status ? <span className="admin-session-status">{status}</span> : null}
        </div>
        <button type="button" className="admin-session-logout" onClick={onLogout} title="Fermer la session administrateur">
          <LogOut size={13} aria-hidden="true" />
          Déconnexion
        </button>
      </div>
    );
  }

  return (
    <form className={`admin-session-panel is-anonymous ${className}`.trim()} onSubmit={onLogin}>
      <span className="admin-session-icon" aria-hidden="true"><ShieldCheck size={15} /></span>
      <div className="admin-session-copy">
        <strong>Connexion administrateur requise</strong>
        <span>{description}</span>
      </div>
      <label className="admin-session-field">
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Mot de passe administrateur"
          aria-label="Mot de passe administrateur"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          disabled={loggingIn}
        />
      </label>
      <button type="submit" className="admin-session-submit" disabled={loggingIn || password.length === 0}>
        {loggingIn ? <LoaderCircle size={13} className="admin-spin" aria-hidden="true" /> : <ShieldCheck size={13} aria-hidden="true" />}
        Se connecter
      </button>
    </form>
  );
}
