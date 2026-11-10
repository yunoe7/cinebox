"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { bunnyPlaybackProgress, bunnyTimeUpdate, withBunnyResume } from "../../lib/cinebox/bunny-playback.mjs";

type PlayerEvent = "ready" | "timeupdate" | "pause" | "seeked" | "ended";
type PlayerInstance = {
  on(event: PlayerEvent, callback: (data?: unknown) => void): void;
  off?(event: PlayerEvent, callback?: (...args: never[]) => void): void;
  getCurrentTime?(callback: (seconds: number) => void): void;
  getDuration?(callback: (duration: number) => void): void;
};
type PlayerJsApi = {
  Player: new (iframe: HTMLIFrameElement) => PlayerInstance;
};

declare global {
  interface Window {
    playerjs?: PlayerJsApi;
  }
}

const PLAYER_JS_URL = "https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js";
const frameStyle: CSSProperties = { width: "100%", height: "100%", minHeight: 420, border: 0, background: "#000" };
let playerJsPromise: Promise<PlayerJsApi> | null = null;

function loadPlayerJs(): Promise<PlayerJsApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("Player.js est indisponible pendant le rendu serveur."));
  if (window.playerjs) return Promise.resolve(window.playerjs);
  if (playerJsPromise) return playerJsPromise;
  playerJsPromise = new Promise<PlayerJsApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PLAYER_JS_URL;
    script.async = true;
    script.onload = () => {
      if (window.playerjs) resolve(window.playerjs);
      else { playerJsPromise = null; reject(new Error("Player.js ne s’est pas exposé.")); }
    };
    script.onerror = () => { playerJsPromise = null; reject(new Error("Player.js n’a pas pu être chargé.")); };
    document.head.append(script);
  });
  return playerJsPromise;
}

type BunnyPlayerProps = {
  src: string;
  resumeAt: number;
  title: string;
  onProgress: (second: number, progress: number) => void;
  onEnded: () => void;
};

/**
 * Bunny Stream embed with the official Player.js bridge.
 * If the script cannot load, the plain iframe is still rendered so playback never breaks.
 */
export default function BunnyPlayer({ src, resumeAt, title, onProgress, onEnded }: BunnyPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [playerjs, setPlayerjs] = useState<PlayerJsApi | null>(null);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [initialResumeAt] = useState(() => resumeAt);
  const handlers = useRef({ onProgress, onEnded });
  useEffect(() => { handlers.current = { onProgress, onEnded }; });

  useEffect(() => {
    let cancelled = false;
    loadPlayerJs()
      .then((api) => { if (!cancelled) setPlayerjs(api); })
      .catch(() => { if (!cancelled) setScriptFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const playbackSrc = withBunnyResume(src, initialResumeAt);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!playerjs || !iframe) return;

    // Player.js 0.0.11 registers a window `message` listener it never removes.
    // Capture it during construction so a closed player does not retain its iframe.
    let playerMessageListener: EventListener | null = null;
    const nativeAddEventListener = window.addEventListener;
    const captureMessageListener = function (
      this: Window,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "message" && !playerMessageListener && typeof listener === "function") playerMessageListener = listener;
      return nativeAddEventListener.call(this, type, listener, options);
    } as typeof window.addEventListener;

    let created: PlayerInstance | null = null;
    window.addEventListener = captureMessageListener;
    try {
      created = new playerjs.Player(iframe);
    } catch {
      return;
    } finally {
      window.addEventListener = nativeAddEventListener;
    }
    const player = created;
    if (!player) return;

    let lastSavedSecond = 0;
    let lastDuration = 0;
    let lastPosition = 0;
    let ended = false;

    const rememberDuration = (duration: unknown) => {
      const total = Number(duration);
      if (Number.isFinite(total) && total > 0) lastDuration = total;
    };

    const save = (seconds: number, duration: number, force = false) => {
      const value = bunnyPlaybackProgress(seconds, duration || lastDuration);
      if (!value) return;
      if (!force && Math.abs(value.second - lastSavedSecond) < 5) return;
      lastSavedSecond = value.second;
      rememberDuration(duration);
      handlers.current.onProgress(value.second, value.progress);
    };

    const saveCurrent = (force = true) => {
      if (typeof player.getCurrentTime !== "function") return;
      player.getCurrentTime((seconds) => {
        if (typeof player.getDuration === "function") player.getDuration((duration) => save(seconds, duration, force));
        else save(seconds, lastDuration, force);
      });
    };

    player.on("ready", () => {
      if (typeof player.getDuration === "function") player.getDuration((duration) => rememberDuration(duration));
    });
    player.on("timeupdate", (payload) => {
      const time = bunnyTimeUpdate(payload);
      if (!time) return;
      lastPosition = time.seconds;
      save(time.seconds, time.duration);
    });
    player.on("pause", () => saveCurrent(true));
    player.on("seeked", () => saveCurrent(true));
    player.on("ended", () => {
      if (ended) return;
      ended = true;
      if (lastDuration > 0) handlers.current.onProgress(Math.floor(lastDuration), 100);
      handlers.current.onEnded();
    });

    return () => {
      if (!ended && lastPosition > 0) save(lastPosition, lastDuration);
      if (playerMessageListener) window.removeEventListener("message", playerMessageListener);
      if (typeof player.off === "function") {
        for (const event of ["ready", "timeupdate", "pause", "seeked", "ended"] as PlayerEvent[]) {
          try { player.off(event); } catch { /* player already detached */ }
        }
      }
    };
  }, [playerjs, playbackSrc]);

  if (!playerjs && !scriptFailed) return <div style={frameStyle} aria-hidden="true" />;

  return (
    <iframe
      ref={iframeRef}
      src={playbackSrc}
      title={title}
      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      style={frameStyle}
    />
  );
}
