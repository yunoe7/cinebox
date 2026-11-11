"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { buildVidsrcEmbedUrl, parseVidsrcPlayerEvent } from "../../lib/cinebox/vidsrc.mjs";
import styles from "./VidsrcPlayer.module.css";

type Props = {
  kind: "movie" | "tv";
  id: number | string;
  season?: number;
  episode?: number;
  resumeAt?: number;
  title: string;
  onProgress: (second: number, progress: number) => void;
  onEnded: () => void;
};

export default function VidsrcPlayer({ kind, id, season, episode, resumeAt = 0, title, onProgress, onEnded }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  // Progress updates change resumeAt every few seconds. Keep the initial resume
  // position for this player instance so those updates never reload the iframe.
  const initialResumeAt = useRef(resumeAt).current;
  const src = useMemo(() => buildVidsrcEmbedUrl({ kind, id, season, episode, startAt: initialResumeAt, subtitleLanguage: "fr" }), [kind, id, season, episode, initialResumeAt]);

  // Do not preflight the Vidsrc info endpoint from the browser: it is cross-origin
  // and commonly blocked by CORS. The embed itself is the authoritative check.
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const parsed = parseVidsrcPlayerEvent(event, frameRef.current?.contentWindow, { mediaType: kind, id });
      if (!parsed) return;
      onProgress(Math.floor(parsed.progress), Math.min(99, Math.round(parsed.progress / parsed.duration * 100)));
      if (parsed.status === "completed") onEnded();
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [kind, id, onProgress, onEnded]);

  return <div className={styles.shell}>
    <div className={styles.topline}><span><i/> VIDSRC</span></div>
    {!frameLoaded && <div className={styles.loading}><LoaderCircle size={22} className={styles.spinner}/><span>Chargement du lecteur…</span></div>}
    <iframe ref={frameRef} className={styles.frame} src={src} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setFrameLoaded(true)}/>
    {frameLoaded && <span className={styles.ready}><Play size={11} fill="currentColor"/> Lecteur prêt</span>}
  </div>;
}
