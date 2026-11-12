import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { readLocalJson } from "./local-storage.mjs";
import { readAsset } from "./storage.ts";

const DB_NAME = "cinebox-assets";
const STORE_NAME = "files";

function memoryStorage(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem() { throw new Error("Une restauration de fixture ne doit pas écrire dans localStorage."); },
    data,
  };
}

function resetIndexedDb() {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value: new IDBFactory(),
  });
}

async function seedLegacyAsset(key, contents) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(new Blob([contents]), key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
}

async function assetText(key) {
  const result = await readAsset(key);
  return result.status === "found" ? result.blob.text() : undefined;
}

const historicalTitle = {
  id: 410,
  name: "Archive synthétique",
  kind: "Série",
  year: 2018,
  genre: "Drame",
  description: "Fixture locale de compatibilité.",
  poster: "",
  progress: 37,
  duration: "1 saison",
  currentTime: 412,
  seasons: [{
    number: 1,
    episodes: [{ number: 1, title: "Épisode conservé", currentTime: 95, progress: 24 }],
  }],
};

test("un titre historique sans propriétés optionnelles se lit sans réécriture", () => {
  const rawTitles = JSON.stringify([historicalTitle]);
  const storage = memoryStorage({ "cinebox-titles": rawTitles });
  const result = readLocalJson(() => storage, "cinebox-titles", Array.isArray);

  assert.equal(result.status, "valid");
  assert.equal(result.raw, rawTitles);
  assert.deepEqual(result.value, [historicalTitle]);
  assert.equal("posterAssetKey" in result.value[0], false);
  assert.equal("videoAssetKey" in result.value[0], false);
  assert.equal("thumbnailAssetKey" in result.value[0].seasons[0].episodes[0], false);
  assert.equal(storage.getItem("cinebox-titles"), rawTitles);
});

test("les clés IndexedDB historiques poster, vidéo et épisode sont lisibles", async () => {
  resetIndexedDb();
  await seedLegacyAsset("410:poster", "affiche ancienne");
  await seedLegacyAsset("410:video", "vidéo ancienne");
  await seedLegacyAsset("410:episode:1:1", "épisode ancien");

  assert.equal(await assetText("410:poster"), "affiche ancienne");
  assert.equal(await assetText("410:video"), "vidéo ancienne");
  assert.equal(await assetText("410:episode:1:1"), "épisode ancien");
});

test("un épisode historique sans clé de miniature reste valide et sans miniature", async () => {
  resetIndexedDb();
  await seedLegacyAsset("411:episode:2:3", "vidéo de saison deux");
  const episode = { number: 3, title: "Sans miniature", currentTime: 18, progress: 9 };

  assert.equal("thumbnailAssetKey" in episode, false);
  assert.equal(await assetText("411:episode:2:3"), "vidéo de saison deux");
  assert.deepEqual(await readAsset("411:episode:2:3:thumbnail"), { status: "missing" });
});

test("les progressions historiques des titres et épisodes sont conservées par lecture JSON", () => {
  const storedTitle = { ...historicalTitle, progress: 37, currentTime: 412 };
  const rawTitles = JSON.stringify([storedTitle]);
  const storage = memoryStorage({ "cinebox-titles": rawTitles });
  const result = readLocalJson(() => storage, "cinebox-titles", Array.isArray);

  assert.equal(result.status, "valid");
  assert.equal(result.value[0].progress, 37);
  assert.equal(result.value[0].currentTime, 412);
  assert.equal(result.value[0].seasons[0].episodes[0].progress, 24);
  assert.equal(result.value[0].seasons[0].episodes[0].currentTime, 95);
  assert.equal(storage.getItem("cinebox-titles"), rawTitles);
});

test("les favoris historiques sont une liste d'identifiants et restent intacts sans catalogue", () => {
  const storedFavorites = [410, 415, 422];
  const storage = memoryStorage({ "cinebox-favorites": JSON.stringify(storedFavorites) });
  const favorites = readLocalJson(() => storage, "cinebox-favorites", (value) =>
    Array.isArray(value) && value.every(Number.isSafeInteger),
  );

  assert.equal(favorites.status, "valid");
  assert.deepEqual(favorites.value, storedFavorites);
  assert.deepEqual(JSON.parse(storage.getItem("cinebox-favorites")), storedFavorites);
});

test("JSON historique incomplet ou invalide est signalé et reste intact", () => {
  const rawMalformed = "[{\"id\":410";
  const malformedStorage = memoryStorage({ "cinebox-titles": rawMalformed });
  const malformed = readLocalJson(() => malformedStorage, "cinebox-titles", Array.isArray);
  assert.equal(malformed.status, "error");
  assert.equal(malformed.reason, "parse");
  assert.equal(malformedStorage.getItem("cinebox-titles"), rawMalformed);

  const rawWrongShape = JSON.stringify({ id: 410, name: "Objet au lieu d'un tableau" });
  const shapeStorage = memoryStorage({ "cinebox-titles": rawWrongShape });
  const wrongShape = readLocalJson(() => shapeStorage, "cinebox-titles", Array.isArray);
  assert.equal(wrongShape.status, "error");
  assert.equal(wrongShape.reason, "invalid");
  assert.equal(shapeStorage.getItem("cinebox-titles"), rawWrongShape);
});

test("un actif historique absent est distinct d'une erreur d'accès IndexedDB", async () => {
  resetIndexedDb();
  assert.deepEqual(await readAsset("499:poster"), { status: "missing" });

  globalThis.indexedDB = { open() { throw new DOMException("accès refusé synthétique", "SecurityError"); } };
  await assert.rejects(readAsset("410:poster"), /accès refusé synthétique/);
});
