"use client";

import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Crown, Lock, Play, Sparkles, Star, X } from "lucide-react";
import type { Title } from "../../lib/cinebox/types";
import { useModalDialog } from "./useModalDialog";

type VipShowcaseModalProps = {
  title: Title | null;
  onClose: () => void;
  onDiscover: () => void;
  onJoin: () => void;
};

const VIP_BENEFITS = [
  "Toutes les exclusivités CinéBox",
  "Les avant-premières avec 48 heures d’avance",
  "La lecture intégrale des films et séries réservés",
];

/**
 * Commercial showcase for a VIP-exclusive title the viewer cannot open.
 *
 * It only ever renders promotional fields already authorised by the catalogue
 * API. It never receives a video URL, a media source or a season list, and it
 * cannot start playback: the only actions are informational and lead to the
 * existing VIP page.
 */
export function VipShowcaseModal({ title, onClose, onDiscover, onJoin }: VipShowcaseModalProps) {
  const reducedMotion = useReducedMotion();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { ref, dialogProps } = useModalDialog<HTMLDivElement>({
    active: Boolean(title),
    onClose,
    initialFocusRef: closeButtonRef,
  });

  return (
    <AnimatePresence>
      {title && (
        <motion.div
          key="vip-showcase"
          className="modal-backdrop vip-showcase-backdrop"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            ref={ref}
            {...dialogProps}
            className="vip-showcase-modal"
            aria-labelledby="vip-showcase-title"
            aria-describedby="vip-showcase-description"
            initial={reducedMotion ? false : { opacity: 0, y: 18, scale: .975 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: .99 }}
            transition={{ duration: reducedMotion ? 0 : .28, ease: "easeOut" }}
          >
            <button ref={closeButtonRef} type="button" className="vip-showcase-close" onClick={onClose} aria-label="Fermer la présentation VIP">
              <X size={16} />
            </button>

            <div className={`vip-showcase-art ${title.poster || title.backdrop ? "has-art" : ""}`}>
              {(title.backdrop || title.poster)
                ? <img src={title.backdrop || title.poster} alt="" aria-hidden="true" />
                : <span className="vip-showcase-art-empty"><Crown size={34} /></span>}
              <span className="vip-showcase-art-shade" />
              <span className="vip-showcase-crown" aria-hidden="true"><Crown size={18} /></span>
              <span className="vip-showcase-reserved"><Lock size={12} /> CONTENU RÉSERVÉ AUX VIP</span>
            </div>

            <div className="vip-showcase-body">
              <span className="vip-showcase-eyebrow"><Sparkles size={12} /> EXCLUSIVITÉ VIP — ACCESSIBLE UNIQUEMENT AUX MEMBRES VIP</span>
              <h2 id="vip-showcase-title">{title.name}</h2>
              <div className="vip-showcase-meta">
                <span>{title.kind}</span>
                {title.year > 0 && <><i>·</i><span>{title.year}</span></>}
                {title.genre && <><i>·</i><span>{title.genre}</span></>}
                {title.duration && <><i>·</i><span>{title.duration}</span></>}
              </div>
              {title.description
                ? <p id="vip-showcase-description" className="vip-showcase-synopsis">{title.description}</p>
                : <p id="vip-showcase-description" className="vip-showcase-synopsis">Un contenu réservé aux membres de CinéBox VIP.</p>}

              <div className="vip-showcase-message" role="note">
                <Star size={15} fill="currentColor" aria-hidden="true" />
                <span>Ce contenu est exclusivement disponible avec CinéBox VIP.</span>
              </div>

              <ul className="vip-showcase-benefits">
                {VIP_BENEFITS.map((benefit) => <li key={benefit}><Check size={13} aria-hidden="true" />{benefit}</li>)}
              </ul>

              <div className="vip-showcase-actions">
                <button type="button" className="vip-showcase-primary" onClick={onDiscover}>
                  <Crown size={15} /> Découvrir les avantages VIP
                </button>
                <button type="button" className="vip-showcase-secondary" onClick={onJoin}>
                  <Play size={14} /> Devenir membre VIP
                </button>
              </div>
              <p className="vip-showcase-footnote">Aucune lecture n’est lancée tant que votre accès VIP n’est pas actif.</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
