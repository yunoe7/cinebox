"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Check, ChevronDown, CircleUserRound, LogIn, LogOut, ShieldCheck } from "lucide-react";
import styles from "./ProfileMenu.module.css";

type Account = { displayName: string; discord: { username: string | null; globalName: string | null; avatarUrl: string | null } | null };

export function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let active = true;
    fetch("/api/account/session", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active) return;
        setAccount(data?.authenticated && data.user ? data.user : null);
        setCheckedSession(true);
      })
      .catch(() => { if (active) setCheckedSession(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); };
  }, [open]);

  const logout = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/account/logout", { method: "POST", headers: { "x-cinebox-request": "1" } });
      if (!response.ok) throw new Error();
      window.location.assign("/");
    } catch { setBusy(false); }
  };

  const name = account?.discord?.globalName || account?.discord?.username || account?.displayName || "Mon compte";
  const initials = name.slice(0, 1).toUpperCase();

  return <div className={styles.root} ref={root}>
    <button ref={trigger} className={styles.trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={account ? `Compte Discord : ${name}` : "Ouvrir la connexion CinéBox"} onClick={() => setOpen((value) => !value)}>
      <span className={styles.avatar}>
        {account?.discord?.avatarUrl && !avatarFailed ? <img src={account.discord.avatarUrl} alt="" onError={() => setAvatarFailed(true)} /> : <span>{account ? initials : <CircleUserRound size={19} />}</span>}
        {account && <i aria-label="Compte connecté"><Check size={9}/></i>}
      </span>
      <span className={styles.triggerCopy}><strong>{account ? name : "Connexion"}</strong><small>{account ? "Discord connecté" : "Espace personnel"}</small></span>
      <ChevronDown size={14} aria-hidden="true" className={open ? styles.chevronOpen : styles.chevron}/>
    </button>

    <AnimatePresence>
      {open && <motion.div className={styles.popover} role="menu" aria-label="Espace personnel"
        initial={reducedMotion ? false : { opacity: 0, y: 9, scale: .98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: 6, scale: .99 }}
        transition={{ duration: reducedMotion ? 0 : .2, ease: [.22, 1, .36, 1] }}>
        <div className={styles.hero}>
          <div className={styles.heroTop}>
            <span className={styles.overline}><span/> ESPACE PERSONNEL</span>
            {account && <span className={styles.connected}><ShieldCheck size={12}/> ACTIF</span>}
          </div>
          <div className={styles.identity}>
            <span className={styles.heroAvatar}>
              {account?.discord?.avatarUrl && !avatarFailed ? <img src={account.discord.avatarUrl} alt="" onError={() => setAvatarFailed(true)} /> : <span>{account ? initials : <CircleUserRound size={26}/>}</span>}
              {account && <i><Check size={11}/></i>}
            </span>
            <span className={styles.identityCopy}>
              <strong>{account ? name : "Votre espace personnel"}</strong>
              <small>{account?.discord?.username ? `@${account.discord.username}` : account ? "Compte CinéBox connecté" : checkedSession ? "Connectez-vous avec Discord" : "Vérification de la session…"}</small>
            </span>
          </div>
          {account ? (
            <a className={styles.accountLink} href="https://discord.com/channels/@me" target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
              Gérer mon compte Discord <ArrowUpRight size={14}/>
            </a>
          ) : (
            <a className={styles.accountLink} href="/api/auth/discord/start" onClick={() => setOpen(false)}>
              <span><LogIn size={14} style={{ verticalAlign: "middle", marginRight: 8 }}/>Se connecter avec Discord</span><ArrowUpRight size={14}/>
            </a>
          )}
        </div>
        {account && <div className={styles.footer}>
          <span>Bibliothèque synchronisée avec votre compte</span>
          <button type="button" disabled={busy} onClick={() => void logout()}><LogOut size={14}/>{busy ? "Déconnexion…" : "Se déconnecter"}</button>
        </div>}
      </motion.div>}
    </AnimatePresence>
  </div>;
}
