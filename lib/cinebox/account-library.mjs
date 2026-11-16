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

/**
 * @param {{ saveFn: Function, initialLibrary: any, initialAccountData: any, initialRevision: number, baseLibrary?: any, maxAttempts?: number }} opts
 */
export async function persistLibrary(opts) {
  const { saveFn, initialLibrary, initialAccountData, initialRevision, baseLibrary, maxAttempts = 3 } = opts;
  let currentLibrary = initialLibrary;
  let currentAccountData = initialAccountData;
  let revision = initialRevision;
  let currentBase = baseLibrary ?? null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await saveFn(currentLibrary, revision);
    if (result.status === "saved") {
      return { ok: true, revision: result.revision, library: currentLibrary, accountData: currentAccountData };
    }
    if (result.status === "conflict") {
      revision = result.revision ?? revision;
      const serverLibrary = result.library && isAccountLibrary(result.library) ? result.library : null;
      if (serverLibrary) {
        const mergedLibrary = mergeLibraries(currentLibrary, serverLibrary, currentBase);
        const mergedAccountData = (() => {
          const d = {};
          d.favorites = mergedLibrary.favorites;
          d.playback = mergedLibrary.playback;
          d.history = mergedLibrary.history;
          d.viewCounts = mergedLibrary.viewCounts;
          d.preferences = mergedLibrary.preferences;
          return d;
        })();
        currentLibrary = mergedLibrary;
        currentAccountData = mergedAccountData;
        currentBase = serverLibrary;
        if (attempt < maxAttempts - 1) continue;
      }
      return { ok: false, revision, library: currentLibrary, accountData: currentAccountData, conflict: true };
    }
    if (result.status === "unauthenticated") throw new Error("Session expirée.");
    throw new Error("Sauvegarde impossible.");
  }
  return { ok: false, revision, library: currentLibrary, accountData: currentAccountData };
}
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
      const baseTitle = (B?.titles || []).find((entry) => isRecord(entry) && entry.id === t.id);
      const serverTitle = titlesById.get(t.id);
      if (baseTitle && serverTitle) {
        titlesById.set(t.id, mergeTitleEdits(baseTitle, serverTitle, t));
      } else {
        titlesById.set(t.id, t);
      }
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

// Pure helper used by the UI to merge concurrent title edits without
// overwriting more recent changes. Three-way field merge: a non-conflicting
// change is kept; on conflict the "latest" (most recent) value wins.
export function mergeTitleEdits(baseTitle, latestTitle, editedTitle) {
  const base = baseTitle && typeof baseTitle === "object" ? baseTitle : null;
  const latest = latestTitle && typeof latestTitle === "object" ? latestTitle : {};
  const edited = editedTitle && typeof editedTitle === "object" ? editedTitle : {};
  const result = { ...latest };

  const mergeField = (key, baseVal, latestVal, editedVal) => {
    if (key === "seasons" && Array.isArray(editedVal) && Array.isArray(latestVal)) {
      return mergeSeasons(base?.seasons, latestVal, editedVal);
    }
    const localChanged = JSON.stringify(editedVal) !== JSON.stringify(baseVal);
    const serverChanged = JSON.stringify(latestVal) !== JSON.stringify(baseVal);
    if (localChanged && !serverChanged) return editedVal;
    if (serverChanged && !localChanged) return latestVal;
    if (localChanged && serverChanged) return latestVal;
    return latestVal;
  };

  const keys = new Set([
    ...Object.keys(base || {}),
    ...Object.keys(latest),
    ...Object.keys(edited),
  ]);
  for (const key of keys) {
    if (key === "id") continue;
    const baseHas = !!base && Object.hasOwn(base, key);
    const latestHas = Object.hasOwn(latest, key);
    const editedHas = Object.hasOwn(edited, key);
    const baseVal = baseHas ? base[key] : undefined;
    const latestVal = latestHas ? latest[key] : undefined;
    const editedVal = editedHas ? edited[key] : undefined;
    const localChanged = baseHas !== editedHas || JSON.stringify(editedVal) !== JSON.stringify(baseVal);
    const serverChanged = baseHas !== latestHas || JSON.stringify(latestVal) !== JSON.stringify(baseVal);
    if (key === "seasons" && editedHas && latestHas && Array.isArray(editedVal) && Array.isArray(latestVal)) {
      result[key] = mergeSeasons(base?.seasons, latestVal, editedVal);
    } else if (localChanged && !serverChanged) {
      if (editedHas) result[key] = editedVal;
      else delete result[key];
    } else if (serverChanged && !localChanged) {
      if (latestHas) result[key] = latestVal;
      else delete result[key];
    } else if (latestHas) {
      result[key] = latestVal;
    } else {
      delete result[key];
    }
  }
  return result;
}

function mergeSeasons(baseSeasons, latestSeasons, editedSeasons) {
  const baseArr = Array.isArray(baseSeasons) ? baseSeasons : [];
  const latestArr = Array.isArray(latestSeasons) ? latestSeasons : [];
  const editedArr = Array.isArray(editedSeasons) ? editedSeasons : [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const merged = [...latestArr];

  for (const editedSeason of editedArr) {
    const baseSeason = baseArr.find((season) => season && season.number === editedSeason.number);
    const latestIndex = merged.findIndex((season) => season && season.number === editedSeason.number);
    if (latestIndex < 0) {
      // A server-side deletion wins over an unchanged local copy.
      if (!baseSeason) merged.push(editedSeason);
      continue;
    }

    const latestSeason = merged[latestIndex];
    const mergedSeason = { ...latestSeason };
    for (const key of Object.keys(editedSeason)) {
      if (key === "episodes") continue;
      const baseHas = !!baseSeason && Object.hasOwn(baseSeason, key);
      const latestHas = Object.hasOwn(latestSeason, key);
      const editedHas = Object.hasOwn(editedSeason, key);
      const baseValue = baseHas ? baseSeason[key] : undefined;
      const latestValue = latestHas ? latestSeason[key] : undefined;
      const editedValue = editedSeason[key];
      const localChanged = !baseHas || !same(editedValue, baseValue);
      const serverChanged = baseHas ? (!latestHas || !same(latestValue, baseValue)) : latestHas;
      if (localChanged && !serverChanged) mergedSeason[key] = editedValue;
    }

    const baseEpisodes = Array.isArray(baseSeason?.episodes) ? baseSeason.episodes : [];
    const latestEpisodes = Array.isArray(latestSeason.episodes) ? latestSeason.episodes : [];
    const editedEpisodes = Array.isArray(editedSeason.episodes) ? editedSeason.episodes : [];
    const mergedEpisodes = [...latestEpisodes];

    for (const editedEpisode of editedEpisodes) {
      const baseEpisode = baseEpisodes.find((episode) => episode && episode.number === editedEpisode.number);
      const episodeIndex = mergedEpisodes.findIndex((episode) => episode && episode.number === editedEpisode.number);
      if (episodeIndex < 0) {
        // Keep a genuinely local addition, but don't resurrect a server deletion.
        if (!baseEpisode) mergedEpisodes.push(editedEpisode);
        continue;
      }

      const latestEpisode = mergedEpisodes[episodeIndex];
      const mergedEpisode = { ...latestEpisode };
      for (const key of Object.keys(editedEpisode)) {
        const baseHas = !!baseEpisode && Object.hasOwn(baseEpisode, key);
        const latestHas = Object.hasOwn(latestEpisode, key);
        const baseValue = baseHas ? baseEpisode[key] : undefined;
        const latestValue = latestHas ? latestEpisode[key] : undefined;
        const editedValue = editedEpisode[key];
        const localChanged = !baseHas || !same(editedValue, baseValue);
        const serverChanged = baseEpisode ? (!latestHas || !same(latestValue, baseValue)) : latestHas;
        if (localChanged && !serverChanged) mergedEpisode[key] = editedValue;
      }
      mergedEpisodes[episodeIndex] = mergedEpisode;
    }

    // Apply local deletions only when the server has not independently changed the item.
    for (const baseEpisode of baseEpisodes) {
      if (editedEpisodes.some((episode) => episode && episode.number === baseEpisode.number)) continue;
      const latestIndexForBase = mergedEpisodes.findIndex((episode) => episode && episode.number === baseEpisode.number);
      if (latestIndexForBase < 0) continue;
      const latestEpisode = mergedEpisodes[latestIndexForBase];
      if (same(latestEpisode, baseEpisode)) mergedEpisodes.splice(latestIndexForBase, 1);
    }

    mergedSeason.episodes = mergedEpisodes;
    merged[latestIndex] = mergedSeason;
  }

  // Apply local season deletions only when the server's copy is unchanged.
  for (const baseSeason of baseArr) {
    if (editedArr.some((season) => season && season.number === baseSeason.number)) continue;
    const latestIndex = merged.findIndex((season) => season && season.number === baseSeason.number);
    if (latestIndex >= 0 && same(merged[latestIndex], baseSeason)) merged.splice(latestIndex, 1);
  }

  return merged;
}

/**
 * Enqueue a library write on a shared promise chain. A failed write must not
 * poison the queue; callers still receive the original rejection.
 */
export function enqueueLibraryWrite(queueRef, task) {
  const previous = queueRef.current || Promise.resolve();
  const operation = Promise.resolve(previous).catch(() => {}).then(task);
  queueRef.current = operation.catch(() => {});
  return operation;
}
