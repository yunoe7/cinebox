/**
 * Catalogue search and merge helpers.
 *
 * Search must be forgiving: case-insensitive, accent-insensitive, and tolerant
 * of extra whitespace. It must also look at the original title so a French
 * user can find a series by its original name.
 */

/**
 * Normalise a string for comparison.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the searchable text of a title. Episode titles are included so a
 * series can be found through one of its episodes.
 * @param {{
 *   name?: string,
 *   originalName?: string,
 *   genre?: string,
 *   genres?: string[],
 *   kind?: string,
 *   description?: string,
 *   year?: number,
 *   cast?: string[],
 *   director?: string,
 *   seasons?: Array<{ episodes?: Array<{ title?: string }> }>,
 * }} title
 * @returns {string}
 */
export function titleSearchText(title) {
  if (!title || typeof title !== "object") return "";
  const parts = [
    title.name,
    title.originalName,
    title.genre,
    ...(Array.isArray(title.genres) ? title.genres : []),
    title.kind,
    title.description,
    title.director,
    ...(Array.isArray(title.cast) ? title.cast : []),
    typeof title.year === "number" ? String(title.year) : "",
    ...(Array.isArray(title.seasons)
      ? title.seasons.flatMap((season) => (Array.isArray(season?.episodes) ? season.episodes.map((episode) => episode?.title) : []))
      : []),
  ];
  return normalizeSearchText(parts.filter((part) => typeof part === "string" && part.trim()).join(" "));
}

/**
 * @param {{ name?: string, originalName?: string, genre?: string, genres?: string[], kind?: string, description?: string, year?: number, cast?: string[], director?: string, seasons?: Array<{ episodes?: Array<{ title?: string }> }> }} title
 * @param {unknown} query
 * @returns {boolean}
 */
export function matchesTitleQuery(title, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return titleSearchText(title).includes(needle);
}

/**
 * Merge the personal library with the shared catalogue.
 *
 * Local titles win: they may carry the user's own media and edits. A shared
 * title is skipped when the same shared id, or the same TMDB id and kind, is
 * already present locally.
 *
 * @template {{
 *   id: number,
 *   kind: string,
 *   sharedId?: string,
 *   tmdbId?: number,
 * }} T
 * @param {T[]} localTitles
 * @param {T[]} sharedTitles
 * @returns {T[]}
 */
export function mergeCatalogTitles(localTitles, sharedTitles) {
  const local = Array.isArray(localTitles) ? localTitles : [];
  const shared = Array.isArray(sharedTitles) ? sharedTitles : [];
  const seen = new Set();
  const seenIds = new Set();
  const identity = (title) => {
    if (title && typeof title.sharedId === "string" && title.sharedId) return `shared:${title.sharedId}`;
    if (title && typeof title.tmdbId === "number" && Number.isFinite(title.tmdbId)) return `tmdb:${title.kind}:${title.tmdbId}`;
    return `id:${title?.id}`;
  };
  const result = [];
  for (const title of local) {
    const key = identity(title);
    if (seen.has(key) || seenIds.has(title?.id)) continue;
    seen.add(key);
    seenIds.add(title?.id);
    result.push(title);
  }
  for (const title of shared) {
    const key = identity(title);
    // A numeric id is the UI identity: never let a shared item collide with a
    // personal title, even when the two namespaces were generated separately.
    if (seen.has(key) || seenIds.has(title?.id)) continue;
    seen.add(key);
    seenIds.add(title?.id);
    result.push(title);
  }
  return result;
}
