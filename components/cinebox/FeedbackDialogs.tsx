"use client";

import { motion } from "framer-motion";
import { ShieldCheck, Trash2, X } from "lucide-react";
import type { Title } from "../../lib/cinebox/types";

export function DeleteConfirmation({ title, onCancel, onConfirm }: {
  title: Title;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div className="modal-backdrop app-confirm-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <motion.div className="app-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" initial={{ opacity: 0, y: 12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .98 }}>
        <div className="confirm-icon"><Trash2 size={19}/></div>
        <div className="eyebrow">GESTION DE LA BIBLIOTHÈQUE</div>
        <h2 id="delete-title">Supprimer ce titre ?</h2>
        <p><strong>{title.name}</strong> sera retiré de votre collection. Cette action ne peut pas être annulée.</p>
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={onCancel}>Annuler</button>
          <button className="confirm-delete" onClick={onConfirm}>Supprimer</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function AppToast({ notice, onClose }: {
  notice: { title: string; message: string };
  onClose: () => void;
}) {
  return (
    <motion.div className="app-toast" role="status" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
      <span className="toast-check"><ShieldCheck size={16}/></span>
      <span><strong>{notice.title}</strong><small>{notice.message}</small></span>
      <button aria-label="Fermer la notification" onClick={onClose}><X size={14}/></button>
    </motion.div>
  );
}
