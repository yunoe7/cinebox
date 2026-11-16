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

export function mergeLibraries(local, server) {
  const L = isAccountLibrary(local) ? local : null;
  const S = isAccountLibrary(server) ? server : null;
  if (!L) return S;
  if (!S) return L;

  // Favorites: union, preserve order (local first).
  const favorites = [...new Set([...(L.favorites || []), ...(S.favorites || [])])];

  // Playback: merge per title and per episode, keeping the higher progress.
  const playback = { ...(S.playback || {}) };
  for (const [titleId, localEntry] of Object.entries(L.playback || {})) {
    const serverEntry = playback[titleId];
    if (!serverEntry) { playback[titleId] = localEntry; continue; }
    const mergedEpisodes = { ...(serverEntry.episodes || {}) };
    for (const [epId, localEp] of Object.entries(localEntry.episodes || {})) {
      const serverEp = mergedEpisodes[epId];
      if (!serverEp) { mergedEpisodes[epId] = localEp; continue; }
      const localProgress = typeof localEp.progress === "number" ? localEp.progress : 0;
      const serverProgress = typeof serverEp.progress === "number" ? serverEp.progress : 0;
      mergedEpisodes[epId] = localProgress >= serverProgress ? { ...serverEp, ...localEp } : { ...localEp, ...serverEp };
    }
    const localCurrent = typeof localEntry.currentSeconds === "number" ? localEntry.currentSeconds : 0;
    const serverCurrent = typeof serverEntry.currentSeconds === "number" ? serverEntry.currentSeconds : 0;
    playback[titleId] = {
      ...serverEntry,
      ...localEntry,
      currentSeconds: Math.max(localCurrent, serverCurrent),
      episodes: mergedEpisodes,
    };
  }

  // History: union, dedupe by titleId+viewedAt, keep most recent 200.
  const historyMap = new Map();
  for (const entry of [...(S.history || []), ...(L.history || [])]) {
    if (!isRecord(entry)) continue;
    historyMap.set(`${entry.titleId}:${entry.viewedAt}`, entry);
  }
  const history = [...historyMap.values()]
    .sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0))
    .slice(0, 200);

  // View counts: per-key max.
  const viewCounts = { ...(S.viewCounts || {}) };
  for (const [key, value] of Object.entries(L.viewCounts || {})) {
    const serverValue = typeof viewCounts[key] === "number" ? viewCounts[key] : 0;
    viewCounts[key] = Math.max(serverValue, typeof value === "number" ? value : 0);
  }

  // Titles: union by id, local wins on conflict (user's current edit).
  const titlesById = new Map();
  for (const t of (S.titles || [])) if (isRecord(t) && Number.isSafeInteger(t.id)) titlesById.set(t.id, t);
  for (const t of (L.titles || [])) if (isRecord(t) && Number.isSafeInteger(t.id)) titlesById.set(t.id, t);

  // Preferences: keep local user intent.
  const preferences = { ...(S.preferences || {}), ...(L.preferences || {}) };

  return {
    version: 1,
    titles: [...titlesById.values()],
    favorites,
    playback,
    history,
    viewCounts,
    preferences,
  };
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
