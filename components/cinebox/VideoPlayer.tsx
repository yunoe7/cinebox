"use client";

import { useEffect, useRef } from "react";
import { retainBlobUrl } from "../../lib/cinebox/blob-url-manager.mjs";

type VideoPlayerProps = {
  src: string;
  resumeAt: number;
  onProgress: (second: number, progress: number) => void;
  onEnded: () => void;
  onView: () => void;
};

export default function VideoPlayer({ src, resumeAt, onProgress, onEnded, onView }: VideoPlayerProps) {
  const lastSavedSecond = useRef(0);
  const countedView = useRef(false);
  const lastDuration = useRef(0);

  useEffect(() => {
    if (!src.startsWith("blob:")) return;
    const lease = retainBlobUrl(src);
    return () => lease.release();
  }, [src]);

  const saveProgress = (video: HTMLVideoElement, force = false) => {
    if (!Number.isFinite(video.currentTime) || video.currentTime < 0) return;
    const second = Math.floor(video.currentTime);
    if (!force && Math.abs(second - lastSavedSecond.current) < 5) return;
    lastSavedSecond.current = second;
    if (Number.isFinite(video.duration) && video.duration > 0) lastDuration.current = video.duration;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : lastDuration.current;
    const progress = duration
      ? Math.min(99, Math.round((video.currentTime / duration) * 100))
      : 0;
    onProgress(second, progress);
  };

  const isUqloadEmbed = /^https?:\/\/(?:www\.)?uqload\.(?:to|vc|com|is|co)\/embed-/i.test(src);

  if (isUqloadEmbed) {
    return <div className="detail-video-embed">
      <iframe
        className="detail-video"
        src={src}
        title="Lecteur vidéo Uqload"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="no-referrer"
      />
      <div className="uqload-playback-fallback" role="note">
        <strong>Le lecteur intégré peut être bloqué par Uqload ou par votre navigateur.</strong>
        <span>La vidéo reste disponible directement chez l'hébergeur. Ouvrez-la dans un nouvel onglet pour la regarder.</span>
        <a href={src} target="_blank" rel="noopener noreferrer">Ouvrir la vidéo sur Uqload <span aria-hidden="true">↗</span></a>
      </div>
    </div>;
  }

  return (
    <video
      className="detail-video"
      src={src}
      controls
      autoPlay
      playsInline
      preload="metadata"
      aria-label="Lecteur vidéo"
      onPlay={() => { if (!countedView.current) { countedView.current = true; onView(); } }}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (resumeAt > 3 && resumeAt < (video.duration || Infinity) - 3) {
          video.currentTime = resumeAt;
        }
      }}
      onTimeUpdate={(event) => saveProgress(event.currentTarget)}
      onRateChange={(event) => saveProgress(event.currentTarget, true)}
      onSeeked={(event) => saveProgress(event.currentTarget, true)}
      onPause={(event) => saveProgress(event.currentTarget, true)}
      onEnded={(event) => {
        const video = event.currentTarget;
        if (video.duration > 0) {
          lastDuration.current = video.duration;
          onProgress(Math.floor(video.duration), 100);
        }
        onEnded();
      }}
    />
  );
}
