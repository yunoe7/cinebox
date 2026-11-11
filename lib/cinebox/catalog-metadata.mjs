/**
 * Canonical shared-catalogue metadata helpers.
 *
 * The local editor and the Bunny library both publish to the same D1
 * `metadata_json` column, but they historically used different field names:
 * `rating`/`director`/`duration` on the editor side and
 * `voteAverage`/`directors`/`runtime` on the Bunny/TMDB side.
 *
 * `normalizeCatalogMetadata` rewrites an incoming metadata patch to the
 * canonical names before it reaches `json_patch`. It only emits meaningful
 * values, so an empty or invalid field never overwrites a valid value already
 * stored in D1. The `resolve*` helpers provide the same fallback on read for
 * rows written before this normalization existed.
 *
 * Rules and precedence:
 * - `voteAverage` wins over `rating`; `rating` is only used when `voteAverage`
 *   is absent or invalid. A rating of 0 means "no TMDB rating" and is not
 *   published, so it cannot erase a real rating.
 * - `directors` wins over `director`; the legacy value is converted to an
 *   array (comma/semicolon separated strings are split, then deduplicated).
 * - `runtime` wins over `duration`; a numeric duration is treated as minutes
 *   and mirrored into `runtime`. `duration` remains the display string when
 *   it is already human-readable.
 * - Aliases are removed from the patch once the canonical field is resolved,
 *   so new writes never contain contradictory duplicates.
 *
 * The normalization is idempotent: running it twice yields the same object.
 */

import { normalizeTmdbRating } from "./tmdb-rating.mjs";

const MAX_DIRECTORS = 10;
const MAX_RUNTIME_MINUTES = 100_000;

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function usableRuntime(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_RUNTIME_MINUTES) {
    return undefined;
  }
  return Math.max(1, Math.round(value));
}

/** Parse a human duration ("1 h 45", "120 min", "95") into minutes. */
function parseDurationMinutes(value) {
  if (typeof value === "number") return usableRuntime(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLocaleLowerCase("fr").replace(",", ".");
  if (!text) return undefined;

  const plainMinutes = text.match(/^(\d+(?:\.\d+)?)$/);
  if (plainMinutes) return usableRuntime(Number(plainMinutes[1]));

  const hoursAndMinutes = text.match(/^(\d+)\s*(?:h|hr|hrs|heure|heures)\s*(\d{1,2})?\s*(?:min|mins|minute|minutes)?$/);
  if (hoursAndMinutes) {
    const minutes = Number(hoursAndMinutes[2] || 0);
    if (minutes > 59) return undefined;
    return usableRuntime(Number(hoursAndMinutes[1]) * 60 + minutes);
  }

  const minutesOnly = text.match(/^(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)$/);
  if (minutesOnly) return usableRuntime(Number(minutesOnly[1]));

  const clock = text.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) {
    const minutes = Number(clock[2]);
    if (minutes > 59) return undefined;
    return usableRuntime(Number(clock[1]) * 60 + minutes);
  }

  return undefined;
}

/** Write-side rating: 0 is treated as "not rated" so it cannot erase a value. */
function usableVoteAverage(value) {
  const rating = normalizeTmdbRating(value);
  return rating !== undefined && rating > 0 ? rating : undefined;
}

/** Normalize a directors value to a deduplicated array of non-empty names. */
export function normalizeDirectors(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;]/)
      : [];
  const seen = new Set();
  const directors = [];
  for (const entry of values) {
    if (typeof entry !== "string") continue;
    const name = entry.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    directors.push(name);
    if (directors.length >= MAX_DIRECTORS) break;
  }
  return directors;
}

/** Normalize a runtime value (minutes) or a human duration string. */
export function normalizeRuntime(value) {
  return typeof value === "string" ? parseDurationMinutes(value) : usableRuntime(value);
}

/**
 * Rewrite a metadata patch to the canonical shared-catalogue schema.
 * Invalid, null and empty values are omitted rather than written.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export function normalizeCatalogMetadata(value) {
  if (!isRecord(value)) return {};
  const result = { ...value };

  const canonicalRating = usableVoteAverage(result.voteAverage);
  const legacyRating = usableVoteAverage(result.rating);
  const rating = canonicalRating ?? legacyRating;
  delete result.rating;
  if (rating === undefined) delete result.voteAverage;
  else result.voteAverage = rating;

  const canonicalDirectors = normalizeDirectors(result.directors);
  const legacyDirectors = normalizeDirectors(result.director);
  const directors = canonicalDirectors.length ? canonicalDirectors : legacyDirectors;
  delete result.director;
  if (directors.length) result.directors = directors;
  else delete result.directors;

  const canonicalRuntime = normalizeRuntime(result.runtime);
  const durationRuntime = parseDurationMinutes(result.duration);
  const runtime = canonicalRuntime ?? durationRuntime;
  if (runtime === undefined) {
    delete result.runtime;
    if (typeof result.duration === "number") delete result.duration;
    if (typeof result.duration === "string" && !result.duration.trim()) delete result.duration;
  } else {
    result.runtime = runtime;
    if (typeof result.duration === "number") {
      result.duration = `${runtime} min`;
    } else if (typeof result.duration === "string") {
      if (!result.duration.trim()) delete result.duration;
      else if (durationRuntime !== undefined && durationRuntime !== runtime) result.duration = `${runtime} min`;
    }
  }

  for (const key of Object.keys(result)) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}

/**
 * Read-side fallback for rows written before normalization.
 * @param {unknown} metadata
 * @returns {number | undefined}
 */
export function resolveVoteAverage(metadata) {
  if (!isRecord(metadata)) return undefined;
  return normalizeTmdbRating(metadata.voteAverage) ?? normalizeTmdbRating(metadata.rating);
}

/**
 * Read-side fallback for rows written before normalization.
 * @param {unknown} metadata
 * @returns {string[]}
 */
export function resolveDirectors(metadata) {
  if (!isRecord(metadata)) return [];
  const canonical = normalizeDirectors(metadata.directors);
  return canonical.length ? canonical : normalizeDirectors(metadata.director);
}

/**
 * Read-side fallback for rows written before normalization.
 * @param {unknown} metadata
 * @returns {number | undefined}
 */
export function resolveRuntime(metadata) {
  if (!isRecord(metadata)) return undefined;
  return normalizeRuntime(metadata.runtime) ?? parseDurationMinutes(metadata.duration);
}

/**
 * Resolve the human-readable duration while keeping `runtime` authoritative.
 * A legacy display string is kept when it is unparsable (for example
 * "2 saisons") or when it agrees with the canonical runtime.
 *
 * @param {unknown} metadata
 * @returns {string}
 */
export function resolveDurationLabel(metadata) {
  if (!isRecord(metadata)) return "";
  const runtime = resolveRuntime(metadata);
  const raw = typeof metadata.duration === "string" ? metadata.duration.trim() : "";
  const parsed = parseDurationMinutes(raw);
  if (raw && (runtime === undefined || parsed === undefined || parsed === runtime)) return raw;
  return runtime === undefined ? "" : `${runtime} min`;
}
