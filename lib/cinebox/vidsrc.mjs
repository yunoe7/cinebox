const VIDSRC_ORIGIN = "https://vidsrc.sh";
const VALID_STATUSES = new Set(["playing", "paused", "completed", "seeked"]);

export function buildVidsrcEmbedUrl({ kind, id, season, episode, startAt = 0, subtitleLanguage = "fr", autoplay = false, autonext = false }) {
  const numericId = typeof id === "number" || (typeof id === "string" && /^\\d+$/.test(id));
  const validId = numericId ? /^\\d+$/.test(String(id)) && Number(id) > 0 : typeof id === "string" && /^tt\\d{7,10}$/.test(id);
  if (!validId) throw new TypeError("Identifiant TMDB ou IMDb invalide.");
  if (kind !== "movie" && kind !== "tv") throw new TypeError("Type de média Vidsrc invalide.");
  const base = numericId ? String(Number(id)) : id;
  const url = new URL(kind === "movie" ? `/embed/movie/${base}` : `/embed/tv/${base}`, VIDSRC_ORIGIN);
  if (kind === "tv" && (season != null || episode != null)) {
    if (!Number.isSafeInteger(season) || season < 0 || !Number.isSafeInteger(episode) || episode < 1) {
      throw new TypeError("Saison ou épisode invalide.");
    }
    url.pathname += `/${season}/${episode}`;
  }
  if (subtitleLanguage) {
    const languages = String(subtitleLanguage).split(",").map((part) => part.trim()).filter((part) => /^[a-z]{2,3}$/i.test(part)).slice(0, 3);
    if (languages.length) url.searchParams.set("ds_lang", languages.join(","));
  }
  if (autoplay) url.searchParams.set("autoplay", "1");
  if (kind === "tv" && autonext) url.searchParams.set("autonext", "1");
  const resume = Number(startAt);
  if (Number.isFinite(resume) && resume > 3) url.searchParams.set("startAt", String(Math.floor(resume)));
  return url.toString();
}

export function buildVidsrcInfoUrl({ kind, id, season, episode }) {
  const embed = new URL(buildVidsrcEmbedUrl({ kind, id, season, episode }));
  embed.pathname = kind === "movie"
    ? `/info/movie/${encodeURIComponent(embed.pathname.split("/").at(-1))}.json`
    : season != null && episode != null
      ? `/info/tv/${encodeURIComponent(embed.pathname.split("/").at(-3))}/${season}/${episode}.json`
      : `/info/tv/${encodeURIComponent(embed.pathname.split("/").at(-1))}.json`;
  // The info endpoint is metadata-only: subtitle and playback query params belong to the embed URL.
  embed.search = "";
  return embed.toString();
}

export function parseVidsrcPlayerEvent(event, iframeWindow, expected = {}) {
  if (!event || event.origin !== VIDSRC_ORIGIN || event.source !== iframeWindow) return null;
  const message = event.data;
  if (!message || typeof message !== "object" || message.type !== "PLAYER_EVENT") return null;
  const data = message.data;
  if (!data || typeof data !== "object" || !VALID_STATUSES.has(data.player_status)) return null;
  const info = data.player_info;
  if (!info || typeof info !== "object" || !["movie", "tv"].includes(info.mediaType)) return null;
  if (expected.mediaType && info.mediaType !== expected.mediaType) return null;
  if (expected.id && String(info.tmdb || info.imdb || "") !== String(expected.id)) return null;
  const progress = Number(data.player_progress);
  const duration = Number(data.player_duration);
  if (!Number.isFinite(progress) || progress < 0 || !Number.isFinite(duration) || duration <= 0 || progress > duration + 2) return null;
  for (const key of ["season", "episode"]) {
    if (info[key] != null && (!Number.isSafeInteger(Number(info[key])) || Number(info[key]) < 0)) return null;
  }
  return {
    status: data.player_status,
    progress: Math.min(progress, duration),
    duration,
    season: info.season == null ? null : Number(info.season),
    episode: info.episode == null ? null : Number(info.episode),
  };
}

export const VIDSRC_ORIGIN_URL = VIDSRC_ORIGIN;
