/**
 * Child-profile safety helpers.
 *
 * CinéBox requires an explicit, verifiable age classification for every title
 * shown to a child profile, whether it comes from the shared D1 catalogue or
 * from the personal library. A missing or unreadable classification is treated
 * as unsafe (fail closed), never as "suitable for everyone".
 *
 * The helpers never infer safety from keywords: only `minAge`, `ageRating`
 * (or another recognised certification) and `isAdult` decide visibility.
 */

import { resolveContentMinAge } from "./age-rating.mjs";

/** Highest minimum age a child profile may see. */
export const CHILD_PROFILE_MAX_AGE = 10;

/**
 * Resolve the classification of a title, whether it comes from D1 or from the
 * personal library.
 * @param {{
 *   minAge?: unknown,
 *   ageRating?: unknown,
 *   isAdult?: unknown,
 *   source?: unknown,
 *   sharedId?: unknown,
 * }} title
 * @returns {number | null}
 */
export function titleMinAge(title) {
  if (!title || typeof title !== "object") return null;
  if (title.isAdult === true) return 18;
  return resolveContentMinAge({ minAge: title.minAge, ageRating: title.ageRating, adult: title.isAdult === true });
}

/**
 * True when the title is safe for a child profile.
 *
 * Every title must carry a real classification at or below
 * `CHILD_PROFILE_MAX_AGE`. Unclassified local and shared titles are hidden.
 *
 * @param {{
 *   minAge?: unknown,
 *   ageRating?: unknown,
 *   isAdult?: unknown,
 *   source?: unknown,
 *   sharedId?: unknown,
 * }} title
 * @returns {boolean}
 */
export function isTitleAllowedForChild(title) {
  if (!title || typeof title !== "object") return false;
  if (title.isAdult === true) return false;
  const minAge = titleMinAge(title);
  return minAge !== null && minAge <= CHILD_PROFILE_MAX_AGE;
}

/**
 * Filter any title list for a profile. Adult profiles keep the list untouched.
 * @template T
 * @param {T[]} titles
 * @param {boolean} isChildProfile
 * @returns {T[]}
 */
export function filterTitlesForProfile(titles, isChildProfile) {
  if (!Array.isArray(titles)) return [];
  return isChildProfile ? titles.filter((title) => isTitleAllowedForChild(/** @type {any} */ (title))) : titles;
}

/**
 * Hero selection.
 *
 * The local/shared catalogue is already merged and filtered before this
 * helper is called. The shared fallback is kept for backward compatibility and
 * is never handed to a child profile.
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
