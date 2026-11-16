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

// Three-way merge that preserves intentional deletions when the server did not
// change the affected element. Falls back to keeping both sides on ambiguity.
/**
 * @param {any} local
 * @param {any} server
 * @param {any} [base]
 */
export function mergeLibraries(local, server, base = null) {
  const L = isAccountLibrary(local) ? local : null;
  const S = isAccountLibrary(server) ? server : null;
  const B = isAccountLibrary(base) ? base : null;
  if (!L) return S;
  if (!S) return L;

  const baseFavorites = new Set(B ? (B.favorites || []) : []);
  const localFavorites = new Set(L.favorites || []);
  const serverFavorites = new Set(S.favorites || []);
  const mergedFavorites = new Set(serverFavorites);
  for (const f of (L.favorites || [])) {
    if (!baseFavorites.has(f)) mergedFavorites.add(f); // local addition
  }
  for (const f of baseFavorites) {
    if (!localFavorites.has(f) && serverFavorites.has(f)) {
      // removed locally, server unchanged -> remove
      mergedFavorites.delete(f);
    }
  }

  const playback = { ...(S.playback || {}) };
  for (const [titleId, localEntry] of Object.entries(L.playback || {})) {
    const serverEntry = playback[titleId];
    const baseEntry = B?.playback?.[titleId];
    if (!serverEntry) { playback[titleId] = localEntry; continue; }
    const mergedEpisodes = { ...(serverEntry.episodes || {}) };
    for (const [epId, localEp] of Object.entries(localEntry.episodes || {})) {
      const serverEp = mergedEpisodes[epId];
      const baseEp = baseEntry?.episodes?.[epId];
      if (!serverEp) { mergedEpisodes[epId] = localEp; continue; }
      const localProgress = typeof localEp.progress === "number" ? localEp.progress : 0;
      const serverProgress = typeof serverEp.progress === "number" ? serverEp.progress : 0;
      const baseProgress = typeof baseEp?.progress === "number" ? baseEp.progress : 0;
      if (localProgress < baseProgress && serverProgress === baseProgress) {
        mergedEpisodes[epId] = { ...serverEp, ...localEp, progress: localProgress, currentSeconds: typeof localEp.currentSeconds === "number" ? localEp.currentSeconds : 0 };
      } else {
        mergedEpisodes[epId] = localProgress >= serverProgress ? { ...serverEp, ...localEp } : { ...localEp, ...serverEp };
      }
    }
    const localCurrent = typeof localEntry.currentSeconds === "number" ? localEntry.currentSeconds : 0;
    const serverCurrent = typeof serverEntry.currentSeconds === "number" ? serverEntry.currentSeconds : 0;
    const baseCurrent = typeof baseEntry?.currentSeconds === "number" ? baseEntry.currentSeconds : 0;
    let currentSeconds = Math.max(localCurrent, serverCurrent);
    if (localCurrent < baseCurrent && serverCurrent === baseCurrent) currentSeconds = localCurrent;
    playback[titleId] = {
      ...serverEntry,
      ...localEntry,
      currentSeconds,
      episodes: mergedEpisodes,
    };
  }

  const historyMap = new Map();
  for (const entry of [...(S.history || []), ...(L.history || [])]) {
    if (!isRecord(entry)) continue;
    historyMap.set(`${entry.titleId}:${entry.viewedAt}`, entry);
  }
  const history = [...historyMap.values()]
    .sort((a, b) => (b.viewedAt || 0) - (a.viewedAt || 0))
    .slice(0, 200);

  const viewCounts = { ...(S.viewCounts || {}) };
  for (const [key, value] of Object.entries(L.viewCounts || {})) {
    const serverValue = typeof viewCounts[key] === "number" ? viewCounts[key] : 0;
    viewCounts[key] = Math.max(serverValue, typeof value === "number" ? value : 0);
  }

  const baseTitleIds = new Set((B?.titles || []).map((t) => (isRecord(t) ? t.id : null)).filter(Number.isSafeInteger));
  const localTitleIds = new Set((L.titles || []).map((t) => (isRecord(t) ? t.id : null)).filter(Number.isSafeInteger));
  const serverTitleIds = new Set((S.titles || []).map((t) => (isRecord(t) ? t.id : null)).filter(Number.isSafeInteger));
  const titlesById = new Map();
  for (const t of (S.titles || [])) if (isRecord(t) && Number.isSafeInteger(t.id)) titlesById.set(t.id, t);
  for (const t of (L.titles || [])) if (isRecord(t) && Number.isSafeInteger(t.id)) {
    if (baseTitleIds.has(t.id) && !localTitleIds.has(t.id)) {
      // removed locally
      if (!serverTitleIds.has(t.id)) titlesById.delete(t.id);
      // else server kept it -> keep (already in map)
    } else {
      titlesById.set(t.id, t); // local wins on edit
    }
  }
  for (const id of baseTitleIds) {
    if (!localTitleIds.has(id)) {
      if (!serverTitleIds.has(id)) {
        titlesById.delete(id);
      } else {
        // local removed; check if server changed it.
        const baseTitle = (B?.titles || []).find((t) => isRecord(t) && t.id === id);
        const serverTitle = (S.titles || []).find((t) => isRecord(t) && t.id === id);
        const serverUnchanged = baseTitle && serverTitle && JSON.stringify(baseTitle) === JSON.stringify(serverTitle);
        if (serverUnchanged) titlesById.delete(id);
        // else: conflict, keep server's (already in map)
      }
    }
  }

  const preferences = { ...(S.preferences || {}), ...(L.preferences || {}) };

  return {
    version: 1,
    titles: [...titlesById.values()],
    favorites: [...mergedFavorites],
    playback,
    history,
    viewCounts,
    preferences,
  };
}