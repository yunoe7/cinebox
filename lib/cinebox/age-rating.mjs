/**
 * Age classification helpers.
 *
 * CinéBox relies on an explicit, verifiable age classification for shared
 * catalogue content. Ratings are stored in D1 `metadata_json` as either
 * `ageRating` (a certification string such as "TP", "12" or "TV-PG") or
 * `minAge` (a numeric minimum age). `adult: true` always means 18+.
 *
 * The helpers are deliberately fail-closed: an unknown or missing rating
 * resolves to `null`, and callers must treat `null` as "not classified" rather
 * than "suitable for everyone".
 */

const RATING_AGES = new Map([
  ["tp", 0],
  ["tous publics", 0],
  ["tous public", 0],
  ["tout public", 0],
  ["g", 0],
  ["tv-y", 0],
  ["tv-g", 0],
  ["u", 0],
  ["e", 0],
  ["0", 0],
  ["-10", 10],
  ["10", 10],
  ["tv-y7", 7],
  ["6", 6],
  ["-6", 6],
  ["7", 7],
  ["pg", 10],
  ["tv-pg", 10],
  ["12", 12],
  ["-12", 12],
  ["12a", 12],
  ["pg-13", 13],
  ["13", 13],
  ["-13", 13],
  ["tv-14", 14],
  ["14", 14],
  ["-14", 14],
  ["15", 15],
  ["-15", 15],
  ["16", 16],
  ["-16", 16],
  ["r", 17],
  ["17", 17],
  ["-17", 17],
  ["18", 18],
  ["18+", 18],
  ["-18", 18],
  ["nc-17", 18],
  ["tv-ma", 18],
  ["x", 18],
]);

/**
 * Convert a certification string or number to a minimum age.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseAgeRating(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.min(99, Math.round(value));
  }
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("fr")
    .replace(/\s+/g, " ");
  if (!normalized) return null;
  if (RATING_AGES.has(normalized)) return RATING_AGES.get(normalized) ?? null;
  const numeric = normalized.match(/^(\d{1,2})\+?$/);
  if (numeric) return Math.min(99, Number(numeric[1]));
  return null;
}

/**
 * Resolve the minimum age of a catalogue item from its metadata.
 * Returns `null` when the item has no usable classification.
 * @param {unknown} metadata
 * @returns {number | null}
 */
export function resolveContentMinAge(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = /** @type {Record<string, unknown>} */ (metadata);
  if (record.adult === true) return 18;
  if (record.isAdult === true) return 18;
  const explicitMinAge = parseAgeRating(record.minAge);
  if (explicitMinAge !== null) return explicitMinAge;
  const candidates = [record.ageRating, record.contentRating, record.certification, record.rated];
  for (const candidate of candidates) {
    const parsed = parseAgeRating(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * True only when the item carries a real classification and that
 * classification is at or below the allowed age.
 * @param {unknown} metadata
 * @param {number} maxAge
 * @returns {boolean}
 */
export function isContentAllowedForAge(metadata, maxAge) {
  if (typeof maxAge !== "number" || !Number.isFinite(maxAge) || maxAge < 0) return false;
  const minAge = resolveContentMinAge(metadata);
  return minAge !== null && minAge <= maxAge;
}

/**
 * Extract the rating string for display, keeping the original certification
 * when one is present.
 * @param {unknown} metadata
 * @returns {string}
 */
export function displayAgeRating(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const record = /** @type {Record<string, unknown>} */ (metadata);
  for (const candidate of [record.ageRating, record.contentRating, record.certification]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 24);
  }
  const minAge = resolveContentMinAge(record);
  return minAge === null ? "" : minAge === 0 ? "Tous publics" : `${minAge}+`;
}
