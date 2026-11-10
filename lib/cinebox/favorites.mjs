/**
 * Favorites visibility helpers.
 *
 * Favorites are stored as numeric title ids. The ids themselves are never
 * removed when a title is hidden from a profile: only the ids resolved against
 * the visible catalogue are counted and displayed. Switching back to an adult
 * profile therefore restores the full stored list.
 */

/**
 * Keep only the favorite ids that resolve to a title the profile may see.
 *
 * The caller passes the catalogue already filtered for the active profile
 * (`filterTitlesForProfile`), so this helper has no profile logic of its own
 * and never mutates either input.
 *
 * @param {Array<{ id?: unknown }>} titles
 * @param {unknown[]} favorites
 * @returns {number[]}
 */
export function visibleFavoriteIds(titles, favorites) {
  if (!Array.isArray(titles) || !Array.isArray(favorites)) return [];
  const visible = new Set();
  for (const title of titles) {
    if (title && typeof title === "object" && Number.isSafeInteger(title.id)) visible.add(title.id);
  }
  const result = [];
  const seen = new Set();
  for (const id of favorites) {
    if (!Number.isSafeInteger(id) || seen.has(id)) continue;
    seen.add(id);
    if (visible.has(id)) result.push(id);
  }
  return result;
}

/**
 * Count visible favorites per title kind.
 * @param {Array<{ id?: unknown, kind?: unknown }>} titles
 * @param {unknown[]} favorites
 * @returns {{ Film: number, Série: number, Vidéo: number, total: number }}
 */
export function favoriteTypeCounts(titles, favorites) {
  const counts = { Film: 0, Série: 0, Vidéo: 0, total: 0 };
  const ids = new Set(visibleFavoriteIds(titles, favorites));
  if (!ids.size || !Array.isArray(titles)) return counts;
  for (const title of titles) {
    if (!title || typeof title !== "object" || !ids.has(title.id)) continue;
    if (title.kind === "Film" || title.kind === "Série" || title.kind === "Vidéo") counts[title.kind] += 1;
    counts.total += 1;
  }
  return counts;
}
