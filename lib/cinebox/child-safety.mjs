/**
 * Child-profile safety helpers.
 *
 * CinéBox has no reliable age classification for catalog content: neither the
 * local library nor the shared D1 catalogue stores an age rating. The only
 * local signal is a small keyword heuristic. That heuristic is kept as a
 * best-effort filter for the personal library, but it must NOT be used to
 * decide whether shared-catalogue content is safe.
 *
 * Shared titles carry no rating, so they are hidden entirely for a child
 * profile (fail closed) until a real classification is published.
 */

const CHILD_RESTRICTED_PATTERN = /(?:18\+|adulte|porn(?:ographique)?|érotique|gore|horreur|épouvante)/i;

/**
 * @param {{ name?: string; genre?: string }} title
 * @returns {boolean}
 */
export function isChildRestrictedTitle(title) {
  const name = typeof title?.name === "string" ? title.name : "";
  const genre = typeof title?.genre === "string" ? title.genre : "";
  return CHILD_RESTRICTED_PATTERN.test(`${name} ${genre}`);
}

/**
 * Best-effort filter for the personal library. Never used for shared titles.
 * @template T
 * @param {T[]} titles
 * @param {boolean} isChildProfile
 * @returns {T[]}
 */
export function filterTitlesForProfile(titles, isChildProfile) {
  if (!Array.isArray(titles)) return [];
  return isChildProfile ? titles.filter((title) => !isChildRestrictedTitle(title)) : titles;
}

/**
 * Shared catalogue content has no age rating, so a child profile must never
 * see it. Adult profiles keep the full catalogue.
 * @param {boolean} isChildProfile
 * @returns {boolean}
 */
export function canShowSharedCatalog(isChildProfile) {
  return !isChildProfile;
}

/**
 * Hero selection.
 *
 * The shared featured title is only a fallback for an adult profile whose
 * personal library is empty. A child profile never receives it, even when the
 * personal library is empty or every local title was filtered out.
 * @template T
 * @param {{
 *   localFeatured: T[],
 *   sharedFeaturedTitle: T | null,
 *   localLibrarySize: number,
 *   isChildProfile: boolean,
 * }} input
 * @returns {T[]}
 */
export function selectFeaturedTitles({ localFeatured, sharedFeaturedTitle, localLibrarySize, isChildProfile }) {
  const local = Array.isArray(localFeatured) ? localFeatured : [];
  if (isChildProfile) return local;
  return localLibrarySize === 0 && sharedFeaturedTitle ? [sharedFeaturedTitle] : local;
}
