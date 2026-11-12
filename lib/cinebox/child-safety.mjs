import { isContentAllowedForAge } from "./age-rating.mjs";

/**
 * Maximum classification shown by a child profile.
 *
 * The child profile is intentionally conservative: only explicitly
 * classified titles rated for ages 12 and under are visible. Missing or
 * unknown classifications are hidden (fail closed). Adult profiles keep
 * the complete catalogue.
 */
export const CHILD_PROFILE_MAX_AGE = 12;

/**
 * Filter catalogue titles for the active profile without mutating the input.
 *
 * @template T
 * @param {T[] | unknown} titles
 * @param {boolean} isChildProfile
 * @returns {T[]}
 */
export function filterTitlesForProfile(titles, isChildProfile) {
  if (!Array.isArray(titles)) return [];
  if (isChildProfile !== true) return titles;
  return titles.filter((title) => isContentAllowedForAge(title, CHILD_PROFILE_MAX_AGE));
}
