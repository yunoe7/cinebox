"use client";

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ShieldCheck, Trash2, X } from "lucide-react";
import type { Title } from "../../lib/cinebox/types";
import { useModalDialog } from "./useModalDialog";

export function DeleteConfirmation({ title, onCancel, onConfirm }: {
  title: Title;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const { ref, dialogProps } = useModalDialog<HTMLDivElement>({
    onClose: onCancel,
    role: "alertdialog",
    initialFocusRef: cancelButtonRef,
  });

  return (
    <motion.div className="modal-backdrop app-confirm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={ref} {...dialogProps} className="app-confirm-modal" aria-labelledby="delete-title" aria-describedby="delete-description" initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .98 }}>
        <div className="confirm-icon"><Trash2 size={19}/></div>
        <div className="eyebrow">GESTION DE LA BIBLIOTHÈQUE</div>
        <h2 id="delete-title">Supprimer ce titre ?</h2>
        <p id="delete-description"><strong>{title.name}</strong> sera retiré de votre collection. Cette action ne peut pas être annulée.</p>
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
