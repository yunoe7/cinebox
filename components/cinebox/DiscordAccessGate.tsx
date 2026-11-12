"use client";

import { CineboxLogo } from "./CineboxLogo";
import styles from "./DiscordAccessGate.module.css";

export function DiscordAccessGate({ connectionError = false }: { connectionError?: boolean }) {
  return (
    <main className={styles.screen}>
      <div className={styles.ambient} aria-hidden="true" />
      <section className={styles.card} aria-labelledby="gate-title">
        <div className={styles.brand}><CineboxLogo variant="loading" /></div>
        <div className={styles.rule} />
        <p className={styles.eyebrow}>ESPACE PRIVÉ · MEMBRES</p>
        <h1 id="gate-title">Votre cinéma, <em>à vous.</em></h1>
        <p className={styles.description}>Connectez-vous avec Discord pour retrouver votre bibliothèque et accéder à l’ensemble de CinéBox.</p>
        {connectionError && <p className={styles.error} role="alert">La vérification de votre session a échoué. Réessayez de vous connecter.</p>}
        <div className={styles.actions}>
          <a className={styles.login} href="/api/auth/discord/start">Se connecter avec Discord <span aria-hidden="true">↗</span></a>
          <a className={styles.discord} href="https://discord.gg/tsuAJFyTMj" target="_blank" rel="noopener noreferrer">
            <svg className={styles.discordIcon} viewBox="0 0 24 24" role="img" aria-label="Discord" focusable="false"><path fill="currentColor" d="M19.7 5.2a18.2 18.2 0 0 0-4.5-1.4l-.6 1.2a16.8 16.8 0 0 0-5.2 0l-.6-1.2a18.2 18.2 0 0 0-4.5 1.4C1.5 9.4.7 13.5 1.1 17.5a18.4 18.4 0 0 0 5.5 2.8l1.2-2a11.8 11.8 0 0 1-1.9-.9l.5-.4a13.1 13.1 0 0 0 11.2 0l.5.4a11.8 11.8 0 0 1-1.9.9l1.2 2a18.4 18.4 0 0 0 5.5-2.8c.5-4.6-.8-8.7-3.2-12.3ZM8.6 14.8c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Zm6.8 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Z"/></svg>
            Rejoindre le Discord
          </a>
        </div>
        <p className={styles.footnote}>Accès réservé aux membres · Connexion sécurisée via Discord</p>
      </section>
      <span className={styles.signature}>CINÉBOX</span>
    </main>
  );
}
