"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, LoaderCircle, Play } from "lucide-react";
import { buildVidsrcEmbedUrl, buildVidsrcInfoUrl, parseVidsrcPlayerEvent } from "../../lib/cinebox/vidsrc.mjs";
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
  const [availability, setAvailability] = useState<"checking" | "available" | "missing" | "error">("checking");
  const [quality, setQuality] = useState("");
  const [frameLoaded, setFrameLoaded] = useState(false);
  const src = useMemo(() => buildVidsrcEmbedUrl({ kind, id, season, episode, startAt: resumeAt, subtitleLanguage: "fr" }), [kind, id, season, episode, resumeAt]);

  useEffect(() => {
    const controller = new AbortController();
    setAvailability("checking");
    setFrameLoaded(false);
    fetch(buildVidsrcInfoUrl({ kind, id, season, episode }), { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (response.status === 404) { setAvailability("missing"); return; }
        if (!response.ok) throw new Error("Vidsrc availability request failed");
        const payload = await response.json();
        if (!payload || payload.status_code !== 200) throw new Error("Invalid Vidsrc info response");
        setQuality(typeof payload.quality === "string" ? payload.quality : "");
        setAvailability("available");
      })
      .catch((error) => { if (error?.name !== "AbortError") setAvailability("error"); });
    return () => controller.abort();
  }, [kind, id, season, episode]);

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

  if (availability === "checking") return <div className={styles.state}><LoaderCircle size={22} className={styles.spinner}/><span>Vérification de la source Vidsrc…</span></div>;
  if (availability === "missing") return <div className={styles.state}><AlertCircle size={22}/><strong>Source Vidsrc indisponible</strong><span>Ce titre ou cet épisode n’est pas référencé actuellement.</span></div>;
  if (availability === "error") return <div className={styles.state}><AlertCircle size={22}/><strong>Vérification impossible</strong><span>La source Vidsrc n’a pas pu être vérifiée. Réessaie plus tard.</span></div>;

  return <div className={styles.shell}>
    <div className={styles.topline}><span><i/> VIDSRC</span>{quality && <small>{quality}</small>}</div>
    {!frameLoaded && <div className={styles.loading}><LoaderCircle size={22} className={styles.spinner}/><span>Chargement du lecteur…</span></div>}
    <iframe ref={frameRef} className={styles.frame} src={src} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setFrameLoaded(true)}/>
    {frameLoaded && <span className={styles.ready}><Play size={11} fill="currentColor"/> Lecteur prêt</span>}
  </div>;
}
