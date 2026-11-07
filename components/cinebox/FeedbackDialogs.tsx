"use client";

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ShieldCheck, Trash2, X } from "lucide-react";
import type { Title } from "../../lib/cinebox/types";

export function DeleteConfirmation({ title, onCancel, onConfirm }: {
  title: Title;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = cancelButtonRef.current?.closest('[role="alertdialog"]');
      const focusable = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onCancel]);

  return (
    <motion.div className="modal-backdrop app-confirm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <motion.div className="app-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .98 }}>
        <div className="confirm-icon"><Trash2 size={19}/></div>
        <div className="eyebrow">GESTION DE LA BIBLIOTHÈQUE</div>
        <h2 id="delete-title">Supprimer ce titre ?</h2>
        <p><strong>{title.name}</strong> sera retiré de votre collection. Cette action ne peut pas être annulée.</p>
        <div className="confirm-actions">
          <button ref={cancelButtonRef} type="button" className="confirm-cancel" onClick={onCancel}>Annuler</button>
          <button type="button" className="confirm-delete" onClick={onConfirm}>Supprimer</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function AppToast({ notice, onClose }: {
  notice: { title: string; message: string };
  onClose: () => void;
}) {
  const autoDismiss = notice.title === "Abonnement indisponible" || notice.title === "Nouveautés indisponible";
  const reducedMotion = useReducedMotion();
  const timerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!autoDismiss) return;
    const timer = window.setTimeout(() => {
      if (timerRef.current === timer) timerRef.current = null;
      onCloseRef.current();
    }, 4500);
    timerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = null;
    };
  }, [autoDismiss, notice]);

  const close = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    onCloseRef.current();
  };

  return (
    <motion.div className="app-toast" role="status" initial={reducedMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }} transition={{ duration: reducedMotion ? 0 : .22, ease: "easeOut" }}>
      <span className="toast-check"><ShieldCheck size={16}/></span>
      <span><strong>{notice.title}</strong><small>{notice.message}</small></span>
      <button aria-label="Fermer la notification" onClick={close}><X size={14}/></button>
    </motion.div>
  );
}
