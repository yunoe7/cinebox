"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Check, ChevronDown, CircleUserRound, LogOut, ShieldCheck } from "lucide-react";
import styles from "./ProfileMenu.module.css";
type Account = { displayName: string; discord: { username: string | null; globalName: string | null; avatarUrl: string | null } | null };
export function ProfileMenu() {
  const [open,setOpen]=useState(false), [account,setAccount]=useState<Account|null>(null), [avatarFailed,setAvatarFailed]=useState(false), [busy,setBusy]=useState(false);
  const root=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null), reducedMotion=useReducedMotion();
  useEffect(()=>{let active=true;fetch("/api/account/session",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(active&&d?.authenticated&&d.user)setAccount(d.user)}).catch(()=>{});return()=>{active=false}},[]);
  useEffect(()=>{if(!open)return;const pointer=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){setOpen(false);trigger.current?.focus()}};document.addEventListener("pointerdown",pointer);document.addEventListener("keydown",key);return()=>{document.removeEventListener("pointerdown",pointer);document.removeEventListener("keydown",key)}},[open]);
  const logout=async()=>{setBusy(true);try{const r=await fetch("/api/account/logout",{method:"POST",headers:{"x-cinebox-request":"1"}});if(!r.ok)throw Error();window.location.assign("/connexion")}catch{setBusy(false)}};
  const name=account?.discord?.globalName||account?.discord?.username||account?.displayName||"Compte Discord", initials=name.slice(0,1).toUpperCase();
  return <div className={styles.root} ref={root}>
    <button ref={trigger} className={styles.trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Compte Discord : ${name}`} onClick={()=>setOpen(v=>!v)}>
      <span className={styles.avatar}>{account?.discord?.avatarUrl&&!avatarFailed?<img src={account.discord.avatarUrl} alt="" onError={()=>setAvatarFailed(true)}/>:<span>{initials||<CircleUserRound size={19}/>}</span>}<i aria-label="Compte connecté"><Check size={9}/></i></span>
      <span className={styles.triggerCopy}><strong>{name}</strong><small>Discord connecté</small></span><ChevronDown size={14} aria-hidden="true" className={open?styles.chevronOpen:styles.chevron}/>
    </button>
    <AnimatePresence>{open&&<motion.div className={styles.popover} role="menu" aria-label="Compte Discord" initial={reducedMotion?false:{opacity:0,y:9,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={reducedMotion?undefined:{opacity:0,y:6,scale:.99}} transition={{duration:reducedMotion?0:.2,ease:[.22,1,.36,1]}}>
      <div className={styles.hero}><div className={styles.heroTop}><span className={styles.overline}><span/> ESPACE PERSONNEL</span><span className={styles.connected}><ShieldCheck size={12}/> ACTIF</span></div>
        <div className={styles.identity}><span className={styles.heroAvatar}>{account?.discord?.avatarUrl&&!avatarFailed?<img src={account.discord.avatarUrl} alt="" onError={()=>setAvatarFailed(true)}/>:<span>{initials}</span>}<i><Check size={11}/></i></span><span className={styles.identityCopy}><strong>{name}</strong><small>{account?.discord?.username?`@${account.discord.username}`:"Identité Discord"}</small></span></div>
        <Link className={styles.accountLink} href="/connexion" onClick={()=>setOpen(false)}>Gérer mon compte Discord <ArrowUpRight size={14}/></Link></div>
      <div className={styles.footer}><span>Bibliothèque synchronisée avec votre compte</span><button type="button" disabled={busy} onClick={()=>void logout()}><LogOut size={14}/>{busy?"Déconnexion…":"Se déconnecter"}</button></div>
    </motion.div>}</AnimatePresence>
  </div>;
}
