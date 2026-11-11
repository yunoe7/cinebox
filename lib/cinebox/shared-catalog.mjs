/**
 * Shared catalogue (D1) helpers.
 *
 * The public API returns D1 rows; the UI works with the local `Title` model.
 * This module owns the mapping and the paginated fetch so the home page can
 * treat the shared catalogue exactly like the personal library.
 */

import { sharedNumericId, tmdbIdFromSharedId } from "./shared-id.mjs";
import { displayAgeRating, resolveContentMinAge } from "./age-rating.mjs";

/** Maximum number of items fetched from the public catalogue. */
export const SHARED_CATALOG_PAGE_SIZE = 50;
export const SHARED_CATALOG_MAX_ITEMS = 500;

const tmdbImage = (path, size = "w500") => {
  if (typeof path !== "string" || !path) return "";
  if (path.startsWith("http")) return path;
  return `https://image.tmdb.org/t/p/${size}${path}`;
};

/**
 * @param {Record<string, unknown>} item
 * @returns {string}
 */
function text(item, key, max = 20000) {
  const value = item[key];
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Map a public catalogue row to the local `Title` shape.
 * @param {{
 *   id?: unknown,
 *   kind?: unknown,
 *   title?: unknown,
 *   overview?: unknown,
 *   releaseDate?: unknown,
 *   posterPath?: unknown,
 *   backdropPath?: unknown,
 *   genres?: unknown,
 *   metadata?: unknown,
 *   seasons?: unknown,
 * }} item
 * @returns {import("./types").Title}
 */
export function sharedCatalogItemToTitle(item) {
  const record = item && typeof item === "object" ? /** @type {Record<string, unknown>} */ (item) : {};
  const rawId = typeof record.id === "string" ? record.id : "";
  const rawKind = record.kind === "series" ? "series" : record.kind === "video" ? "video" : "movie";
  const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? /** @type {Record<string, unknown>} */ (record.metadata)
    : {};
  const tmdbId = Number.isSafeInteger(metadata.tmdbId) && Number(metadata.tmdbId) > 0
    ? Number(metadata.tmdbId)
    : tmdbIdFromSharedId(rawId);
  const genres = Array.isArray(record.genres)
    ? record.genres.filter((genre) => typeof genre === "string").slice(0, 30)
    : [];
  const seasons = Array.isArray(record.seasons)
    ? record.seasons
        .filter((season) => season && typeof season === "object" && Number.isSafeInteger(/** @type {any} */ (season).number))
        .map((season) => {
          const value = /** @type {any} */ (season);
          return {
            number: value.number,
            episodes: Array.isArray(value.episodes)
              ? value.episodes
                  .filter((episode) => episode && typeof episode === "object" && Number.isSafeInteger(episode.number))
                  .map((episode) => ({
                    number: episode.number,
                    title: typeof episode.title === "string" ? episode.title : `Épisode ${episode.number}`,
                    overview: typeof episode.overview === "string" ? episode.overview : "",
                    runtime: typeof episode.runtime === "number" ? episode.runtime : undefined,
                    thumbnailUrl: tmdbImage(episode.thumbnailPath, "w300") || undefined,
                    videoUrl: typeof episode.videoUrl === "string" ? episode.videoUrl : undefined,
                    tmdbId: typeof episode.tmdbId === "number" ? episode.tmdbId : undefined,
                  }))
              : [],
          };
        })
    : [];
  const bunnyVideoId = typeof metadata.bunnyVideoId === "string" ? metadata.bunnyVideoId : "";
  const bunnyLibraryId = typeof metadata.bunnyLibraryId === "string" ? metadata.bunnyLibraryId : "";
  const releaseDate = text(record, "releaseDate", 20);
  const parsedYear = releaseDate ? new Date(releaseDate).getUTCFullYear() : NaN;
  const year = Number.isFinite(parsedYear) ? parsedYear : 0;
  const kind = rawKind === "series" ? "Série" : rawKind === "video" ? "Vidéo" : "Film";
  const runtime = typeof metadata.runtime === "number" ? metadata.runtime : null;
  const duration = typeof metadata.duration === "string" && metadata.duration
    ? metadata.duration
    : runtime
      ? `${runtime} min`
      : kind === "Série"
        ? `${seasons.length} saison${seasons.length === 1 ? "" : "s"}`
        : "";
  const minAge = resolveContentMinAge(metadata);
  const ageRating = displayAgeRating(metadata);
  const cast = Array.isArray(metadata.cast)
    ? metadata.cast
        .map((person) => (typeof person === "string" ? person : person && typeof person === "object" && typeof /** @type {any} */ (person).name === "string" ? /** @type {any} */ (person).name : ""))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const directors = Array.isArray(metadata.directors)
    ? metadata.directors.filter((director) => typeof director === "string")
    : [];
  return {
    id: sharedNumericId({ id: rawId, kind: rawKind, tmdbId }),
    name: text(record, "title", 300) || "Titre sans nom",
    kind,
    year,
    genre: genres.join(" · "),
    genres,
    description: text(record, "overview"),
    poster: tmdbImage(record.posterPath),
    backdrop: tmdbImage(record.backdropPath, "w1280"),
    progress: 0,
    duration,
    seasons: seasons.length ? seasons : undefined,
    videoUrl: bunnyVideoId && bunnyLibraryId
      ? `https://iframe.mediadelivery.net/embed/${bunnyLibraryId}/${bunnyVideoId}`
      : undefined,
    rating: typeof metadata.voteAverage === "number" ? metadata.voteAverage : undefined,
    voteCount: typeof metadata.voteCount === "number" ? metadata.voteCount : undefined,
    cast,
    director: directors.length ? directors.join(", ") : undefined,
    originalName: typeof metadata.originalName === "string" ? metadata.originalName : undefined,
    originalLanguage: typeof metadata.originalLanguage === "string" ? metadata.originalLanguage : undefined,
    releaseDate: releaseDate || undefined,
    tmdbId,
    sharedId: rawId,
    totalSeasons: seasons.length,
    totalEpisodes: seasons.reduce((sum, season) => sum + season.episodes.length, 0),
    source: "shared",
    ageRating: ageRating || undefined,
    minAge: minAge ?? undefined,
    isAdult: metadata.adult === true || metadata.isAdult === true || minAge === 18,
  };
}

/**
 * Fetch every published page of the public catalogue.
 *
 * The endpoint is paginated (50 items max). In environments where the
 * Cloudflare Functions are not served (`next dev`), the endpoint answers with
 * HTML: the content-type guard keeps the page usable instead of throwing.
 *
 * @param {{ maxAge?: number | null, signal?: AbortSignal, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<import("./types").Title[]>}
 */
export async function fetchSharedCatalogTitles(options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) return [];
  const maxAge = typeof options.maxAge === "number" && Number.isFinite(options.maxAge) ? options.maxAge : null;
  const collected = [];
  const seen = new Set();
  for (let offset = 0; offset < SHARED_CATALOG_MAX_ITEMS; offset += SHARED_CATALOG_PAGE_SIZE) {
    const params = new URLSearchParams({ limit: String(SHARED_CATALOG_PAGE_SIZE), offset: String(offset) });
    if (maxAge !== null) params.set("maxAge", String(maxAge));
    let response;
    try {
      response = await fetchImpl(`/api/catalog?${params.toString()}`, {
        signal: options.signal,
        headers: { accept: "application/json" },
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return collected;
      break;
    }
    if (!response.ok) break;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) break;
    let payload;
    try { payload = await response.json(); } catch { break; }
    const titles = payload && typeof payload === "object" && Array.isArray(/** @type {any} */ (payload).titles)
      ? /** @type {any} */ (payload).titles
      : null;
    if (!titles) break;
    for (const item of titles) {
      const mapped = sharedCatalogItemToTitle(item);
      if (!mapped.sharedId || seen.has(mapped.sharedId)) continue;
      seen.add(mapped.sharedId);
      collected.push(mapped);
    }
    if (titles.length < SHARED_CATALOG_PAGE_SIZE) break;
  }
  return collected;
}
