"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Check, ChevronDown, CircleUserRound, LogOut, Settings2, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { Profile } from "../../lib/cinebox/profiles.mjs";
import styles from "./ProfileMenu.module.css";

type DiscordAccount = {
  displayName: string;
  discord: { username: string | null; globalName: string | null; avatarUrl: string | null } | null;
};

export function ProfileMenu({ profile, onManage, onSwitch, onUnavailable }: {
  profile: Profile;
  onManage: () => void;
  onSwitch: () => void;
  onUnavailable: (feature: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<DiscordAccount | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<HTMLButtonElement[]>([]);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let active = true;
    fetch("/api/account/session", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data?.authenticated && data.user) setAccount(data.user); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    items.current.find((item) => item && !item.disabled)?.focus();
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const activate = (action: () => void) => { trigger.current?.focus({ preventScroll: true }); setOpen(false); action(); };
  const handleMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.current.filter((item) => item && !item.disabled);
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      enabled[(index + direction + enabled.length) % enabled.length]?.focus();
    } else if (event.key === "Home") { event.preventDefault(); enabled[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); enabled.at(-1)?.focus(); }
  };

  const logout = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/account/logout", { method: "POST", headers: { "x-cinebox-request": "1" } });
      if (!response.ok) throw new Error("Déconnexion impossible");
      window.location.assign("/connexion");
    } catch {
      setBusy(false);
      onUnavailable("déconnexion du compte Discord");
    }
  };

  const discordName = account?.discord?.globalName || account?.discord?.username || account?.displayName || "Compte Discord";
  const initials = discordName.slice(0, 1).toUpperCase();

  return <div className={styles.root} ref={root}>
    <button ref={trigger} className={styles.trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Compte Discord : ${discordName}`} onClick={() => setOpen((value) => !value)}>
      <span className={styles.avatar}>
        {account?.discord?.avatarUrl && !avatarFailed
          ? <img src={account.discord.avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
          : <span>{initials || <CircleUserRound size={19}/>}</span>}
        <i aria-label="Compte connecté"><Check size={9}/></i>
      </span>
      <span className={styles.triggerCopy}><strong>{discordName}</strong><small>Discord connecté</small></span>
      <ChevronDown size={14} aria-hidden="true" className={open ? styles.chevronOpen : styles.chevron}/>
    </button>
    <AnimatePresence>
      {open && <motion.div className={styles.popover} role="menu" aria-label="Compte Discord et profil CinéBox" onKeyDown={handleMenuKey}
        initial={reducedMotion ? false : { opacity: 0, y: 9, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reducedMotion ? undefined : { opacity: 0, y: 6, scale: .99 }} transition={{ duration: reducedMotion ? 0 : .2, ease: [0.22, 1, 0.36, 1] }}>
        <div className={styles.hero}>
          <div className={styles.heroTop}><span className={styles.overline}><span/> ESPACE PERSONNEL</span><span className={styles.connected}><ShieldCheck size={12}/> ACTIF</span></div>
          <div className={styles.identity}>
            <span className={styles.heroAvatar}>
              {account?.discord?.avatarUrl && !avatarFailed ? <img src={account.discord.avatarUrl} alt="" onError={() => setAvatarFailed(true)}/> : <span>{initials}</span>}
              <i><Check size={11}/></i>
            </span>
            <span className={styles.identityCopy}><strong>{discordName}</strong><small>{account?.discord?.username ? `@${account.discord.username}` : "Identité Discord"}</small></span>
          </div>
          <Link className={styles.accountLink} href="/connexion" onClick={() => setOpen(false)}>Gérer mon compte Discord <ArrowUpRight size={14}/></Link>
        </div>
        <div className={styles.sectionLabel}>VOTRE CINÉBOX</div>
        <button ref={(node) => { if (node) items.current[0] = node; }} type="button" role="menuitem" onClick={() => activate(onManage)}><span className={styles.itemIcon}><Users size={16}/></span><span className={styles.itemCopy}><strong>Mes profils</strong><small>Gérer les profils et préférences</small></span><span className={styles.itemAction}>Gérer</span></button>
        <div className={styles.activeProfile}><span className={styles.activeDot}/><span>Profil utilisé</span><strong>{profile.name}</strong></div>
        <button ref={(node) => { if (node) items.current[1] = node; }} type="button" role="menuitem" onClick={() => activate(onSwitch)}><span className={styles.itemIcon}><Settings2 size={16}/></span><span className={styles.itemCopy}><strong>Changer de profil</strong><small>Conserver la bibliothèque partagée</small></span><span className={styles.itemAction}>Changer</span></button>
        <button ref={(node) => { if (node) items.current[2] = node; }} type="button" role="menuitem" onClick={() => activate(() => onUnavailable("Abonnement"))}><span className={styles.itemIcon}><Sparkles size={16}/></span><span className={styles.itemCopy}><strong>Abonnement & nouveautés</strong><small>Les options arrivent bientôt</small></span><span className={styles.soon}>BIENTÔT</span></button>
        <div className={styles.footer}><span>Session sécurisée par Discord</span><button type="button" disabled={busy} onClick={() => void logout()}><LogOut size={14}/>{busy ? "Déconnexion…" : "Se déconnecter"}</button></div>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
