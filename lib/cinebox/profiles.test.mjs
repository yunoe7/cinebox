import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  PROFILE_STORAGE_KEY,
  createProfile,
  deleteProfile,
  isProfileStore,
  loadOrMigrateProfiles,
  overlayProfileData,
  selectProfile,
  setPrimaryProfile,
  updateProfile,
  updateProfileData,
  writeProfileStore,
} from "./profiles.mjs";
import { hashProfilePin, verifyProfilePin } from "./profile-pin.mjs";

function memoryStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
    entries,
  };
}

const legacyTitles = { status: "valid", value: [{ id: 11, currentTime: 55, progress: 18, viewCount: 3, seasons: [{ number: 2, episodes: [{ number: 4, currentTime: 23, progress: 12 }] }] }] };
const legacyFavorites = { status: "valid", value: [11] };

test("migration crée le profil principal depuis les anciennes données sans les réécrire", () => {
  const oldTitlesRaw = JSON.stringify(legacyTitles.value);
  const oldFavoritesRaw = JSON.stringify(legacyFavorites.value);
  const storage = memoryStorage({ "cinebox-titles": oldTitlesRaw, "cinebox-favorites": oldFavoritesRaw });
  const result = loadOrMigrateProfiles(storage, legacyTitles, legacyFavorites, { id: "profile-main", createdAt: 1 });
  assert.equal(result.status, "ready");
  assert.equal(result.migrated, true);
  assert.equal(storage.getItem("cinebox-titles"), oldTitlesRaw);
  assert.equal(storage.getItem("cinebox-favorites"), oldFavoritesRaw);
  assert.deepEqual(result.store.data["profile-main"].favorites, [11]);
  assert.deepEqual(result.store.data["profile-main"].playback["11"], { assetKey: "11:video", currentTime: 55, progress: 18, episodes: { "2:4": { assetKey: "11:episode:2:4", currentTime: 23, progress: 12 } } });
  assert.equal(result.store.data["profile-main"].viewCounts["11"], 3);
});

test("une migration incomplète ou un journal de profils invalide n'écrase rien", () => {
  const storage = memoryStorage({ "cinebox-titles": "legacy", "cinebox-favorites": "[11]", [PROFILE_STORAGE_KEY]: "broken" });
  const invalid = loadOrMigrateProfiles(storage, legacyTitles, legacyFavorites);
  assert.equal(invalid.status, "error");
  assert.equal(storage.getItem(PROFILE_STORAGE_KEY), "broken");
  const unavailable = loadOrMigrateProfiles(memoryStorage(), { status: "error" }, legacyFavorites);
  assert.equal(unavailable.status, "error");
  assert.equal(unavailable.reason, "legacy-unavailable");
});

test("chaque profil garde favoris, progression, historique et préférences isolés", () => {
  const storage = memoryStorage();
  const initial = loadOrMigrateProfiles(storage, legacyTitles, legacyFavorites, { id: "profile-main", createdAt: 1 }).store;
  let next = createProfile(initial, { name: "Invité", avatarId: "moon-cat", isChild: false }, { id: "profile-guest", createdAt: 2 });
  next = updateProfileData(next, "profile-guest", (data) => ({ ...data, favorites: [], playback: { "11": { currentTime: 0, progress: 0, episodes: {} } }, history: [{ titleId: 11, viewedAt: 4 }], preferences: { autoplayNext: false } }));
  assert.deepEqual(next.data["profile-main"].favorites, [11]);
  assert.equal(next.data["profile-main"].playback["11"].currentTime, 55);
  assert.deepEqual(next.data["profile-guest"].favorites, []);
  assert.equal(next.data["profile-guest"].playback["11"].currentTime, 0);
  assert.equal(next.data["profile-guest"].history[0].titleId, 11);
  assert.equal(next.data["profile-guest"].preferences.autoplayNext, false);
  assert.equal(isProfileStore(next), true);
});

test("sélection, modification, avatar, mode enfant et profil principal persistent", () => {
  const main = loadOrMigrateProfiles(memoryStorage(), { status: "missing" }, { status: "missing" }, { id: "profile-main", createdAt: 1 }).store;
  let next = createProfile(main, { name: "Enfant", avatarId: "star-fox", isChild: true }, { id: "profile-child", createdAt: 2 });
  next = updateProfile(next, "profile-child", { name: "Noé", avatarId: "amber-owl", isChild: true });
  next = setPrimaryProfile(next, "profile-child");
  next = selectProfile(next, "profile-child");
  assert.equal(next.profiles.find((profile) => profile.id === "profile-child").name, "Noé");
  assert.equal(next.profiles.find((profile) => profile.id === "profile-child").isChild, true);
  assert.equal(next.profiles.find((profile) => profile.id === "profile-child").isPrimary, true);
  assert.equal(next.activeProfileId, "profile-child");
  assert.equal(isProfileStore(next), true);
});

test("le profil principal est impossible à supprimer et la limite reste à huit", () => {
  const main = loadOrMigrateProfiles(memoryStorage(), { status: "missing" }, { status: "missing" }, { id: "profile-main", createdAt: 1 }).store;
  assert.throws(() => deleteProfile(main, "profile-main"), /principal/);
  let store = main;
  for (let index = 1; index < 8; index++) store = createProfile(store, { name: `Profil ${index}` }, { id: `profile-${index}`, createdAt: index + 1 });
  assert.equal(store.profiles.length, 8);
  assert.throws(() => createProfile(store, { name: "Trop" }, { id: "profile-overflow" }), /limite/);
  const afterDelete = deleteProfile(store, "profile-7");
  assert.equal(afterDelete.profiles.length, 7);
  assert.equal(isProfileStore(afterDelete), true);
});

test("écrire puis recharger conserve la bibliothèque historique et les profils", () => {
  const storage = memoryStorage({ "cinebox-titles": "titles-exact", "cinebox-favorites": "favorites-exact" });
  const store = loadOrMigrateProfiles(storage, legacyTitles, legacyFavorites, { id: "profile-main", createdAt: 1 }).store;
  assert.equal(writeProfileStore(storage, store).ok, true);
  const loaded = loadOrMigrateProfiles(storage, legacyTitles, legacyFavorites);
  assert.equal(loaded.status, "ready");
  assert.equal(loaded.migrated, false);
  assert.equal(storage.getItem("cinebox-titles"), "titles-exact");
  assert.equal(storage.getItem("cinebox-favorites"), "favorites-exact");
  assert.deepEqual(loaded.store, store);
});

test("la vue active superpose sa progression sans changer le catalogue de base", () => {
  const titles = [{ id: 11, progress: 70, currentTime: 55, seasons: [{ number: 2, episodes: [{ number: 4, progress: 40, currentTime: 23 }] }] }];
  const data = { favorites: [], playback: { "11": { currentTime: 4, progress: 5, episodes: { "2:4": { currentTime: 8, progress: 9 } } } }, history: [], viewCounts: {}, preferences: { autoplayNext: true } };
  const overlay = overlayProfileData(titles, data);
  assert.equal(overlay[0].currentTime, 4);
  assert.equal(overlay[0].seasons[0].episodes[0].currentTime, 8);
  assert.equal(titles[0].currentTime, 55);
  assert.equal(titles[0].seasons[0].episodes[0].currentTime, 23);
});

test("un PIN est haché avec sel et PBKDF2, jamais conservé en clair", async () => {
  const record = await hashProfilePin("1234", webcrypto);
  assert.notEqual(record.hash, "1234");
  assert.equal(record.salt.length, 32);
  assert.equal(record.hash.length, 64);
  assert.equal(await verifyProfilePin("1234", record, webcrypto), true);
  assert.equal(await verifyProfilePin("4321", record, webcrypto), false);
  assert.notDeepEqual(await hashProfilePin("1234", webcrypto), record);
  await assert.rejects(hashProfilePin("12ab", webcrypto), /4 à 8 chiffres/);
});
