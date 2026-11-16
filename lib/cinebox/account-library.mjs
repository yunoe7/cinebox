const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isFiniteNonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

function withoutLocalMedia(title) {
  const { videoUrl, videoAssetKey, posterAssetKey, backdropAssetKey, ...rest } = title;
  const cleanUrl = (value) => typeof value === "string" && !value.startsWith("blob:") ? value : "";
  return {
    ...rest,
    poster: cleanUrl(rest.poster),
    backdrop: cleanUrl(rest.backdrop),
    seasons: Array.isArray(rest.seasons) ? rest.seasons.map((season) => {
      const { posterAssetKey: _posterAssetKey, posterUrl, ...seasonRest } = season;
      return {
        ...seasonRest,
        posterUrl: cleanUrl(posterUrl),
        episodes: Array.isArray(season.episodes) ? season.episodes.map((episode) => {
          const { videoUrl: _videoUrl, videoAssetKey: _videoAssetKey, thumbnailAssetKey: _thumbnailAssetKey, thumbnailUrl, ...episodeRest } = episode;
          return { ...episodeRest, thumbnailUrl: cleanUrl(thumbnailUrl) };
        }) : [],
      };
    }) : undefined,
  };
}

function withoutLocalPlayback(playback) {
  return Object.fromEntries(Object.entries(isRecord(playback) ? playback : {}).map(([id, value]) => {
    const { assetKey: _assetKey, ...entry } = isRecord(value) ? value : {};
    const episodes = Object.fromEntries(Object.entries(isRecord(entry.episodes) ? entry.episodes : {}).map(([episodeId, episode]) => {
      const { assetKey: _episodeAssetKey, ...episodeRest } = isRecord(episode) ? episode : {};
      return [episodeId, episodeRest];
    }));
    return [id, { ...entry, episodes }];
  }));
}

// Build the single Discord account's cloud library from its personal data.
export function createAccountLibrary(accountData, titles) {
  const data = isRecord(accountData) ? accountData : {};
  return {
    version: 1,
    titles: (Array.isArray(titles) ? titles : []).map(withoutLocalMedia),
    favorites: Array.isArray(data.favorites) ? [...new Set(data.favorites.filter(Number.isSafeInteger))] : [],
    playback: withoutLocalPlayback(data.playback),
    history: Array.isArray(data.history) ? data.history.slice(0, 200).filter((entry) => isRecord(entry) && Number.isSafeInteger(entry.titleId) && isFiniteNonnegative(entry.viewedAt)) : [],
    viewCounts: isRecord(data.viewCounts) ? data.viewCounts : {},
    preferences: { autoplayNext: data.preferences?.autoplayNext !== false },
  };
}

export function isAccountLibrary(value) {
  return isRecord(value) && value.version === 1 && Array.isArray(value.titles) &&
    Array.isArray(value.favorites) && value.favorites.every(Number.isSafeInteger) &&
    isRecord(value.playback) && Array.isArray(value.history) &&
    value.history.every((entry) => isRecord(entry) && Number.isSafeInteger(entry.titleId) && isFiniteNonnegative(entry.viewedAt)) &&
    isRecord(value.viewCounts) && isRecord(value.preferences) && typeof value.preferences.autoplayNext === "boolean";
}

export async function fetchAccountLibrary(fetcher = fetch) {
  const response = await fetcher("/api/account/library", { cache: "no-store", headers: { "x-cinebox-request": "1" } });
  if (response.status === 401) return { status: "unauthenticated" };
  if (!response.ok) throw new Error("La bibliothèque du compte est indisponible.");
  const payload = await response.json();
  if (!payload || (payload.library !== null && !isAccountLibrary(payload.library)) || !Number.isSafeInteger(payload.revision) || payload.revision < 0) {
    throw new Error("La réponse de la bibliothèque du compte est invalide.");
  }
  return { status: "ready", library: payload.library, revision: payload.revision };
}

export async function saveAccountLibrary(library, revision, fetcher = fetch) {
  if (!isAccountLibrary(library) || !Number.isSafeInteger(revision) || revision < 0) throw new Error("La bibliothèque à sauvegarder est invalide.");
  const response = await fetcher("/api/account/library", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-cinebox-request": "1" },
    body: JSON.stringify({ library, revision }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 409) return { status: "conflict", revision: payload.revision, library: payload.library ?? null };
  if (response.status === 401) return { status: "unauthenticated" };
  if (!response.ok || payload.saved !== true || !Number.isSafeInteger(payload.revision)) throw new Error("La sauvegarde de la bibliothèque a échoué.");
  return { status: "saved", revision: payload.revision };
}
