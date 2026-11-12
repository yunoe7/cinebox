"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AccountUser = { id: string; displayName: string; email?: string | null; role: string };

const discordErrors: Record<string, string> = {
  session: "Ta session a expiré. Reconnecte-toi avec Discord.",
  "discord-state": "La demande de connexion a expiré. Réessaie.",
  "discord-config": "La connexion Discord n'est pas encore configurée.",
  "discord-token": "Discord n'a pas pu valider la connexion. Réessaie.",
  "discord-profile": "Impossible de récupérer ton profil Discord.",
  "discord-already-linked": "Ce compte Discord est déjà associé à un autre compte CinéBox.",
  "discord-unavailable": "La connexion Discord est momentanément indisponible. Réessaie.",
};

export default function ConnexionPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [user, setUser] = useState<AccountUser | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("erreur");
    if (reason) setError(discordErrors[reason] || "La connexion n'a pas abouti. Réessaie.");
    if (params.get("connexion") === "discord") setNotice("Connexion Discord réussie. Bienvenue sur CinéBox !");
    if (params.get("discord") === "lie") setNotice("Ton compte Discord est bien associé à CinéBox.");
    fetch("/api/account/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (data.authenticated) setUser(data.user); })
      .catch(() => {});
  }, []);

  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/logout", {
        method: "POST",
        headers: { "x-cinebox-request": "1" },
      });
      if (!response.ok) throw new Error("Déconnexion impossible.");
      setUser(null);
      setNotice("Tu es bien déconnecté.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Déconnexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="account-page">
      <section className="account-card">
        <Link href="/" className="account-back">← Retour à CinéBox</Link>
        <div className="account-kicker">VOTRE CINÉMA PERSONNEL</div>
        <h1>{user ? "Heureux de te revoir." : "Bienvenue sur CinéBox."}</h1>
        <p className="account-intro">
          {user
            ? "Ton compte CinéBox est connecté à Discord."
            : "Retrouve ton espace cinéma en te connectant simplement avec ton compte Discord."}
        </p>

        {notice && <p className="account-notice" role="status">{notice}</p>}
        {error && <p className="account-error" role="alert">{error}</p>}

        {user ? (
          <div className="account-logged">
            <strong>{user.displayName}</strong>
            <span>Connecté avec Discord</span>
            <button disabled={busy} onClick={logout}>
              {busy ? "Patiente…" : "Se déconnecter"}
            </button>
          </div>
        ) : (
          <>
            <a className="account-discord" href="/api/auth/discord/start">
              <span aria-hidden="true">◉</span>
              Continuer avec Discord
            </a>
            <p className="account-note">
              La connexion est sécurisée par Discord. CinéBox ne te demandera jamais ton mot de passe Discord.
            </p>
          </>
        )}

        <p className="account-legal">En continuant, tu acceptes d'utiliser un compte personnel CinéBox.</p>
      </section>
    </main>
  );
}
