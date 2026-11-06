"use client";

import { useRef } from "react";

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
