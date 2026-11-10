/**
 * Stable identity helpers for the shared catalogue.
 *
 * The local library identifies titles with a numeric id (`Date.now()` for new
 * titles). D1 identifies the same titles with a string id. These helpers keep
 * both sides deterministic and collision-free:
 *
 * - `tmdb:movie:<n>`  -> `<n>`              (kept for backward compatibility)
 * - `tmdb:series:<n>` -> `-<n>`             (a film and a series can share a TMDB id)
 * - `tmdb:video:<n>`  -> `-(n + 1e12)`      (separate namespace)
 * - `cinebox:<n>`     -> `<n>`              (the local id is authoritative)
 *
 * Only pure functions live here so they can be unit-tested without a browser
 * or a D1 database.
 */

const CINEBOX_ID_PATTERN = /^cinebox:([0-9]{1,20})$/;
const TMDB_ID_PATTERN = /^tmdb:(movie|series|video):([0-9]{1,12})$/;
const VIDEO_OFFSET = 1_000_000_000_000;

/**
 * @param {unknown} kind
 * @returns {"movie" | "series" | "video"}
 */
export function sharedKind(kind) {
  if (kind === "series" || kind === "Série") return "series";
  if (kind === "video" || kind === "Vidéo") return "video";
  return "movie";
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSharedTitleId(value) {
  return typeof value === "string" && (CINEBOX_ID_PATTERN.test(value) || TMDB_ID_PATTERN.test(value));
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function tmdbIdFromSharedId(value) {
  if (typeof value !== "string") return undefined;
  const match = TMDB_ID_PATTERN.exec(value);
  if (!match) return undefined;
  const id = Number(match[2]);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/**
 * Resolve the D1 id for a local title that is being published.
 *
 * An explicit `cinebox:` id wins so a title that already exists in D1 keeps
 * its identity even after TMDB metadata is added. Otherwise a TMDB id is
 * preferred, and a brand-new manual title falls back to `cinebox:<localId>`.
 *
 * @param {{ tmdbId?: number | null, kind?: string, localId?: number, existingSharedId?: string | null }} input
 * @returns {string}
 */
export function resolveSharedId({ tmdbId, kind, localId, existingSharedId }) {
  const existing = typeof existingSharedId === "string" ? existingSharedId : "";
  if (CINEBOX_ID_PATTERN.test(existing)) return existing;
  const safeTmdb = Number.isSafeInteger(tmdbId) && Number(tmdbId) > 0 ? Number(tmdbId) : null;
  if (safeTmdb) return `tmdb:${sharedKind(kind)}:${safeTmdb}`;
  if (isSharedTitleId(existing)) return existing;
  return Number.isSafeInteger(localId) && Number(localId) > 0 ? `cinebox:${localId}` : "";
}

/**
 * Validate and resolve the D1 id from a publish request. Returns "" when the
 * request is inconsistent (unknown kind, id/kind mismatch, TMDB id mismatch).
 *
 * @param {{ id?: unknown, kind?: unknown, tmdbId?: unknown }} input
 * @returns {string}
 */
export function resolvePublishId({ id, kind, tmdbId }) {
  const safeKind = kind === "movie" || kind === "series" || kind === "video" ? kind : "";
  if (!safeKind) return "";
  const safeTmdb = Number.isSafeInteger(tmdbId) && Number(tmdbId) > 0 ? Number(tmdbId) : null;
  const raw = typeof id === "string" ? id : "";
  if (CINEBOX_ID_PATTERN.test(raw)) return raw;
  const match = TMDB_ID_PATTERN.exec(raw);
  if (match) {
    if (match[1] !== safeKind) return "";
    if (safeTmdb !== null && Number(match[2]) !== safeTmdb) return "";
    return raw;
  }
  return safeTmdb !== null ? `tmdb:${safeKind}:${safeTmdb}` : "";
}

/**
 * Numeric id used by the local UI for a shared catalogue item. It is stable
 * across reloads and keeps films and series with the same TMDB id distinct.
 *
 * @param {{ id?: unknown, kind?: unknown, tmdbId?: unknown }} input
 * @returns {number}
 */
export function sharedNumericId({ id, kind, tmdbId }) {
  const raw = typeof id === "string" ? id : "";
  const localMatch = CINEBOX_ID_PATTERN.exec(raw);
  if (localMatch) {
    const value = Number(localMatch[1]);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  const match = TMDB_ID_PATTERN.exec(raw);
  const tmdbFromId = match ? Number(match[2]) : null;
  const safeTmdb = Number.isSafeInteger(tmdbId) && Number(tmdbId) > 0
    ? Number(tmdbId)
    : (Number.isSafeInteger(tmdbFromId) && Number(tmdbFromId) > 0 ? Number(tmdbFromId) : null);
  if (safeTmdb !== null) {
    const resolvedKind = match ? match[1] : sharedKind(kind);
    if (resolvedKind === "series") return -safeTmdb;
    if (resolvedKind === "video") return -(safeTmdb + VIDEO_OFFSET);
    return safeTmdb;
  }
  let hash = 0;
  for (const char of raw) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) || 1;
}
