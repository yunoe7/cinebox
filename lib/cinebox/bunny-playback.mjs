const BUNNY_EMBED_ORIGINS = new Set([
  "https://iframe.mediadelivery.net",
  "https://player.mediadelivery.net",
]);

/** Recognize the Bunny Stream embed URLs used by the shared catalogue. */
export function isBunnyEmbedUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return BUNNY_EMBED_ORIGINS.has(url.origin) && /^\/embed\/[^/]+\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Add the official Bunny `t` parameter when a saved position is worth restoring. */
export function withBunnyResume(value, seconds) {
  if (!isBunnyEmbedUrl(value)) return value;
  const position = Number(seconds);
  if (!Number.isFinite(position) || position <= 3) return value;
  const url = new URL(value);
  url.searchParams.set("t", String(Math.floor(position)));
  return url.toString();
}

/** Normalize Player.js timing payloads across Bunny player versions. */
export function bunnyTimeUpdate(payload) {
  let data = payload;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== "object") return null;
  const seconds = Number(data.seconds);
  const duration = Number(data.duration);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return { seconds, duration: Number.isFinite(duration) && duration > 0 ? duration : 0 };
}

/** Keep non-ended playback below 100 %, matching the local video player. */
export function bunnyPlaybackProgress(seconds, duration) {
  const current = Number(seconds);
  if (!Number.isFinite(current) || current < 0) return null;
  const total = Number(duration);
  const second = Math.floor(current);
  if (!Number.isFinite(total) || total <= 0) return { second, progress: 0 };
  return { second, progress: Math.min(99, Math.round((current / total) * 100)) };
}
