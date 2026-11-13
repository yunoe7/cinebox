"use client";

import type { ReactNode } from "react";
import { LoaderCircle, LogOut, ShieldCheck } from "lucide-react";

export type AdminAuthState = "checking" | "anonymous" | "authenticated";

type AdminSessionPanelProps = {
  authState: AdminAuthState;
  onLogin: () => void;
  onLogout: () => void;
  description: string;
  status?: ReactNode;
  className?: string;
};

export function AdminSessionPanel({ authState, onLogin, onLogout, description, status, className = "" }: AdminSessionPanelProps) {
  if (authState === "checking") {
    return <div className={`admin-session-panel is-checking ${className}`.trim()} role="status">
      <span className="admin-session-icon" aria-hidden="true"><LoaderCircle size={15} className="admin-spin" /></span>
      <div className="admin-session-copy"><strong>Vérification de la session…</strong><span>CinéBox vérifie ton compte Discord.</span></div>
    </div>;
  }

  if (authState === "authenticated") {
    return <div className={`admin-session-panel is-authenticated ${className}`.trim()}>
      <span className="admin-session-icon" aria-hidden="true"><ShieldCheck size={15} /></span>
      <div className="admin-session-copy"><strong>Administrateur connecté avec Discord</strong>{status ? <span className="admin-session-status">{status}</span> : null}</div>
      <button type="button" className="admin-session-logout" onClick={onLogout} title="Déconnexion du compte Discord"><LogOut size={13} aria-hidden="true" />Déconnexion</button>
    </div>;
  }

  return <div className={`admin-session-panel is-anonymous ${className}`.trim()}>
    <span className="admin-session-icon" aria-hidden="true"><ShieldCheck size={15} /></span>
    <div className="admin-session-copy"><strong>Connexion Discord administrateur requise</strong><span>{description}</span></div>
    <button type="button" className="admin-session-submit" onClick={onLogin}><ShieldCheck size={13} aria-hidden="true" />Se connecter avec Discord</button>
  </div>;
}
