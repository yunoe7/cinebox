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

  const saveProgress = (video: HTMLVideoElement, force = false) => {
    const second = Math.floor(video.currentTime);
    if (!force && second - lastSavedSecond.current < 5) return;
    lastSavedSecond.current = second;
    const progress = video.duration
      ? Math.min(99, Math.round((video.currentTime / video.duration) * 100))
      : 0;
    onProgress(second, progress);
  };

  return (
    <video
      className="detail-video"
      src={src}
      controls
      autoPlay
      onPlay={() => { if (!countedView.current) { countedView.current = true; onView(); } }}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (resumeAt > 3 && resumeAt < (video.duration || Infinity) - 3) {
          video.currentTime = resumeAt;
        }
      }}
      onTimeUpdate={(event) => saveProgress(event.currentTarget)}
      onPause={(event) => saveProgress(event.currentTarget, true)}
      onEnded={onEnded}
    />
  );
}
