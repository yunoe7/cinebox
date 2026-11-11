"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { ProfileAvatar } from "./ProfileAvatar";
import type { Profile } from "../../lib/cinebox/profiles.mjs";

export function ProfileMenu({ profile, onManage, onSwitch, onUnavailable }: {
  profile: Profile;
  onManage: () => void;
  onSwitch: () => void;
  onUnavailable: (feature: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<HTMLButtonElement[]>([]);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    items.current[0]?.focus();
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Menu items are unmounted as soon as the menu closes. Restore focus to the
  // stable trigger first so a dialog opened by the action can return it there.
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

  return <div className="profile-menu-root" ref={root}>
    <button ref={trigger} className="profile-menu-trigger" type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Profil actif : ${profile.name}`} onClick={() => setOpen((value) => !value)}>
      <ProfileAvatar avatarId={profile.avatarId} label={`Avatar de ${profile.name}`} />
      <span className="profile-menu-trigger-copy"><strong>{profile.name}</strong><small>{profile.isChild ? "Profil enfant" : "Profil actif"}</small></span>
      <ChevronDown size={14} aria-hidden="true" className={open ? "is-open" : ""} />
    </button>
    <AnimatePresence>
      {open && <motion.div className="profile-menu-popover" role="menu" aria-label={`Menu de ${profile.name}`} onKeyDown={handleMenuKey}
        initial={reducedMotion ? false : { opacity: 0, y: 8, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reducedMotion ? undefined : { opacity: 0, y: 6, scale: .99 }} transition={{ duration: reducedMotion ? 0 : .18, ease: [0.22, 1, 0.36, 1] }}>
        <div className="profile-menu-heading"><ProfileAvatar avatarId={profile.avatarId} size={44} label={`Avatar de ${profile.name}`}/><span><strong>{profile.name}</strong><small>{profile.isChild ? "Profil enfant · Données locales" : "Profil actif · Données locales"}</small></span></div>
        <div className="profile-menu-divider" />
        <button ref={(node) => { if (node) items.current[0] = node; }} type="button" role="menuitem" onClick={() => activate(onManage)}>Profil <small>Gérer</small></button>
        <button ref={(node) => { if (node) items.current[1] = node; }} type="button" role="menuitem" onClick={() => activate(() => onUnavailable("Abonnement"))}>S’abonner <small>Indisponible</small></button>
        <button ref={(node) => { if (node) items.current[2] = node; }} type="button" role="menuitem" onClick={() => activate(() => onUnavailable("Nouveautés"))}>Nouveautés <small>Indisponible</small></button>
        <button ref={(node) => { if (node) items.current[3] = node; }} type="button" role="menuitem" onClick={() => activate(onManage)}>Paramètres</button>
        <button ref={(node) => { if (node) items.current[4] = node; }} type="button" role="menuitem" onClick={() => activate(onSwitch)}>Quitter ce profil <small>Changer</small></button>
        <div className="profile-menu-foot">Le changement de profil conserve les médias et la bibliothèque partagée.</div>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
