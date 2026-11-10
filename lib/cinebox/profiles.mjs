export const PROFILE_STORAGE_KEY = "cinebox-profiles";
export const MAX_PROFILES = 8;

const PROFILE_FIELDS = new Set(["id", "name", "avatarId", "isChild", "isPrimary", "pin", "createdAt"]);
const DATA_FIELDS = new Set(["favorites", "playback", "history", "viewCounts", "preferences"]);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonnegativeFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validPin(value) {
  return value === null || (isRecord(value) && typeof value.salt === "string" && /^[a-f\d]{32}$/i.test(value.salt) &&
    typeof value.hash === "string" && /^[a-f\d]{64}$/i.test(value.hash) && value.iterations === 180000);
}

function validProfile(value) {
  return isRecord(value) && Object.keys(value).every((key) => PROFILE_FIELDS.has(key)) &&
    typeof value.id === "string" && /^[a-z\d-]{4,80}$/i.test(value.id) &&
    typeof value.name === "string" && value.name.trim().length > 0 && value.name.trim().length <= 24 &&
    typeof value.avatarId === "string" && /^[a-z\d-]{2,40}$/i.test(value.avatarId) &&
    typeof value.isChild === "boolean" && typeof value.isPrimary === "boolean" &&
    validPin(value.pin) && isNonnegativeFinite(value.createdAt);
}

function validData(value) {
  if (!isRecord(value) || !Object.keys(value).every((key) => DATA_FIELDS.has(key))) return false;
  if (!Array.isArray(value.favorites) || !value.favorites.every(Number.isSafeInteger) || new Set(value.favorites).size !== value.favorites.length) return false;
  if (!isRecord(value.playback) || !isRecord(value.viewCounts) || !isRecord(value.preferences) || typeof value.preferences.autoplayNext !== "boolean") return false;
  if (!Array.isArray(value.history) || value.history.length > 200 || !value.history.every((entry) => isRecord(entry) && Number.isSafeInteger(entry.titleId) && isNonnegativeFinite(entry.viewedAt))) return false;
  for (const playback of Object.values(value.playback)) {
    if (!isRecord(playback) || (playback.assetKey !== undefined && typeof playback.assetKey !== "string") || !isNonnegativeFinite(playback.currentTime) || !isNonnegativeFinite(playback.progress) || !isRecord(playback.episodes)) return false;
    for (const episode of Object.values(playback.episodes)) {
      if (!isRecord(episode) || (episode.assetKey !== undefined && typeof episode.assetKey !== "string") || !isNonnegativeFinite(episode.currentTime) || !isNonnegativeFinite(episode.progress)) return false;
    }
  }
  return Object.entries(value.viewCounts).every(([id, count]) => /^\d+$/.test(id) && Number.isSafeInteger(count) && count >= 0);
}

export function isProfileStore(value) {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length < 1 || value.profiles.length > MAX_PROFILES ||
    !isRecord(value.data) || !value.profiles.every(validProfile) || !value.profiles.every((profile) => Object.hasOwn(value.data, profile.id) && validData(value.data[profile.id]))) return false;
  const ids = value.profiles.map((profile) => profile.id);
  return new Set(ids).size === ids.length && value.profiles.filter((profile) => profile.isPrimary).length === 1 &&
    value.profiles.some((profile) => profile.id === value.activeProfileId);
}

function makeId(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === "function") return `p-${cryptoSource.randomUUID()}`;
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function emptyProfileData() {
  return { favorites: [], playback: {}, history: [], viewCounts: {}, preferences: { autoplayNext: true } };
}

function legacyProfileData(titles, favorites) {
  const data = emptyProfileData();
  data.favorites = favorites.status === "valid" ? [...favorites.value] : [];
  for (const title of titles.status === "valid" ? titles.value : []) {
    const episodes = {};
    for (const season of title.seasons || []) {
      for (const episode of season.episodes || []) {
        if (episode.currentTime || episode.progress) episodes[`${season.number}:${episode.number}`] = {
          assetKey: episode.videoAssetKey || `${title.id}:episode:${season.number}:${episode.number}`,
          currentTime: episode.currentTime || 0,
          progress: episode.progress || 0,
        };
      }
    }
    if (title.currentTime || title.progress || Object.keys(episodes).length) data.playback[String(title.id)] = {
      assetKey: title.videoAssetKey || `${title.id}:video`,
      currentTime: title.currentTime || 0,
      progress: title.progress || 0,
      episodes,
    };
    if (title.viewCount) data.viewCounts[String(title.id)] = title.viewCount;
  }
  return data;
}

export function createInitialProfileStore(titles, favorites, options = {}) {
  const id = options.id || makeId(options.crypto);
  const profile = {
    id,
    name: "Principal",
    avatarId: "golden-reel",
    isChild: false,
    isPrimary: true,
    pin: null,
    createdAt: options.createdAt ?? Date.now(),
  };
  return { version: 1, profiles: [profile], activeProfileId: id, data: { [id]: legacyProfileData(titles, favorites) } };
}

/** Read or create the new profile store without modifying either legacy key. */
export function loadOrMigrateProfiles(storage, titles, favorites, options = {}) {
  let raw;
  try { raw = storage.getItem(PROFILE_STORAGE_KEY); }
  catch (error) { return { status: "error", reason: "access", error }; }

  if (raw !== null) {
    try {
      const value = JSON.parse(raw);
      if (!isProfileStore(value)) return { status: "error", reason: "invalid", error: new Error("Le stockage des profils est invalide et a été conservé.") };
      return { status: "ready", store: value, migrated: false };
    } catch (error) {
      return { status: "error", reason: "invalid", error: new Error(`Le stockage des profils est illisible et a été conservé : ${error.message}`) };
    }
  }

  if (titles.status === "error" || favorites.status === "error") {
    return { status: "error", reason: "legacy-unavailable", error: new Error("Les données historiques n’ont pas pu être lues ; la création des profils est différée.") };
  }
  const store = createInitialProfileStore(titles, favorites, options);
  let serialized;
  try {
    serialized = JSON.stringify(store);
    storage.setItem(PROFILE_STORAGE_KEY, serialized);
    if (storage.getItem(PROFILE_STORAGE_KEY) !== serialized) throw new Error("La vérification du stockage des profils a échoué.");
  } catch (error) {
    return { status: "error", reason: "write", error };
  }
  return { status: "ready", store, migrated: true };
}

export function writeProfileStore(storage, store) {
  if (!isProfileStore(store)) return { ok: false, reason: "invalid", error: new Error("Le profil préparé est invalide.") };
  let serialized;
  try { serialized = JSON.stringify(store); }
  catch (error) { return { ok: false, reason: "serialize", error }; }
  try {
    storage.setItem(PROFILE_STORAGE_KEY, serialized);
    if (storage.getItem(PROFILE_STORAGE_KEY) !== serialized) return { ok: false, reason: "verify", error: new Error("L’écriture des profils n’a pas pu être vérifiée.") };
    return { ok: true };
  } catch (error) { return { ok: false, reason: error?.name === "QuotaExceededError" ? "quota" : "access", error }; }
}

export function createProfile(store, input, options = {}) {
  if (store.profiles.length >= MAX_PROFILES) throw new Error(`La limite de ${MAX_PROFILES} profils est atteinte.`);
  const name = String(input.name || "").trim();
  if (!name || name.length > 24) throw new Error("Le nom doit contenir entre 1 et 24 caractères.");
  if (store.profiles.some((profile) => profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Ce nom de profil existe déjà.");
  const profile = {
    id: options.id || makeId(options.crypto),
    name,
    avatarId: input.avatarId || "golden-reel",
    isChild: Boolean(input.isChild),
    isPrimary: false,
    pin: input.pin ?? null,
    createdAt: options.createdAt ?? Date.now(),
  };
  const next = { ...store, profiles: [...store.profiles, profile], data: { ...store.data, [profile.id]: emptyProfileData() } };
  if (!isProfileStore(next)) throw new Error("Les informations du profil sont invalides.");
  return next;
}

export function updateProfile(store, profileId, patch) {
  const current = store.profiles.find((profile) => profile.id === profileId);
  if (!current) throw new Error("Profil introuvable.");
  const name = String(patch.name ?? current.name).trim();
  if (!name || name.length > 24) throw new Error("Le nom doit contenir entre 1 et 24 caractères.");
  if (store.profiles.some((profile) => profile.id !== profileId && profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Ce nom de profil existe déjà.");
  const nextProfile = { ...current, name, avatarId: patch.avatarId ?? current.avatarId, isChild: patch.isChild ?? current.isChild, pin: patch.pin === undefined ? current.pin : patch.pin };
  const next = { ...store, profiles: store.profiles.map((profile) => profile.id === profileId ? nextProfile : profile) };
  if (!isProfileStore(next)) throw new Error("Les informations du profil sont invalides.");
  return next;
}

export function deleteProfile(store, profileId) {
  const profile = store.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error("Profil introuvable.");
  if (profile.isPrimary) throw new Error("Le profil principal ne peut pas être supprimé.");
  const { [profileId]: _removed, ...data } = store.data;
  const profiles = store.profiles.filter((item) => item.id !== profileId);
  const next = { ...store, profiles, data, activeProfileId: store.activeProfileId === profileId ? profiles.find((item) => item.isPrimary).id : store.activeProfileId };
  if (!isProfileStore(next)) throw new Error("La suppression préparerait un stockage invalide.");
  return next;
}

export function setPrimaryProfile(store, profileId) {
  if (!store.profiles.some((profile) => profile.id === profileId)) throw new Error("Profil introuvable.");
  return { ...store, profiles: store.profiles.map((profile) => ({ ...profile, isPrimary: profile.id === profileId })) };
}

export function selectProfile(store, profileId) {
  if (!store.profiles.some((profile) => profile.id === profileId)) throw new Error("Profil introuvable.");
  return { ...store, activeProfileId: profileId };
}

export function updateProfileData(store, profileId, updater) {
  if (!Object.hasOwn(store.data, profileId)) throw new Error("Données de profil introuvables.");
  const data = updater(structuredClone(store.data[profileId]));
  const next = { ...store, data: { ...store.data, [profileId]: data } };
  if (!isProfileStore(next)) throw new Error("Les données préparées du profil sont invalides.");
  return next;
}

const VIEW_DEDUPE_WINDOW_MS = 30_000;

/** Record a view without duplicating an accidental immediate replay of the same title. */
export function addProfileView(data, titleId, viewedAt = Date.now()) {
  const last = data.history[0];
  const duplicate = Boolean(last && last.titleId === titleId && viewedAt - last.viewedAt < VIEW_DEDUPE_WINDOW_MS);
  if (duplicate) return data;
  return {
    ...data,
    viewCounts: { ...data.viewCounts, [String(titleId)]: (data.viewCounts[String(titleId)] || 0) + 1 },
    history: [{ titleId, viewedAt }, ...data.history].slice(0, 200),
  };
}

export function overlayProfileData(titles, profileData) {
  return titles.map((title) => {
    const data = profileData.playback[String(title.id)];
    const titleAssetKey = title.videoAssetKey || `${title.id}:video`;
    const titlePlayback = data && (!data.assetKey || data.assetKey === titleAssetKey) ? data : undefined;
    const episodes = title.seasons?.map((season) => ({ ...season, episodes: season.episodes.map((episode) => {
      const saved = data?.episodes[`${season.number}:${episode.number}`];
      const episodeAssetKey = episode.videoAssetKey || `${title.id}:episode:${season.number}:${episode.number}`;
      return saved && (!saved.assetKey || saved.assetKey === episodeAssetKey)
        ? { ...episode, currentTime: saved.currentTime, progress: saved.progress }
        : { ...episode, currentTime: 0, progress: 0 };
    }) }));
    return {
      ...title,
      progress: titlePlayback?.progress ?? 0,
      currentTime: titlePlayback?.currentTime ?? 0,
      viewCount: profileData.viewCounts[String(title.id)] ?? 0,
      ...(episodes ? { seasons: episodes } : {}),
    };
  });
}

export function getProfileEpisodeKey(season, episode) {
  return `${season}:${episode}`;
}
