import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import {
  createMediaCleanupJob,
  processMediaCleanupJobs,
  publishWithMediaCleanupJournal,
  readMediaCleanupJobs,
} from "./media-cleanup.mjs";
import { deleteAssetKeys, readAsset } from "./storage.ts";

const ASSET_DB = "cinebox-assets";
const ASSET_STORE = "files";

function resetDb() {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: lockManager() } });
}

function lockManager() {
  const events = [];
  return {
    events,
    request: async (name, options, callback) => {
      events.push(["acquire", name, options.mode]);
      try { return await callback(); }
      finally { events.push(["release", name]); }
    },
  };
}

async function seed(dbName, storeName, key, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => dbName === "cinebox-cleanup"
      ? request.result.createObjectStore(storeName, { keyPath: "id" })
      : request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    if (dbName === "cinebox-cleanup") tx.objectStore(storeName).put(value);
    else tx.objectStore(storeName).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

async function exists(key) {
  return (await readAsset(key)).status === "found";
}

test("01 — journal écrit avant la publication et suppression confirmée après", async () => {
  resetDb();
  await seed(ASSET_DB, ASSET_STORE, "31:poster", new Blob(["old"]));
  const order = [];
  const result = await publishWithMediaCleanupJournal({
    obsoleteKeys: ["31:poster"], operation: "title-update",
    commitMetadata: async () => {
      const jobs = await readMediaCleanupJobs();
      assert.equal(jobs.length, 1);
      order.push("published");
      return true;
    },
    readReferencedKeys: async () => new Set(),
    deleteAssets: async (keys) => { order.push(`delete:${keys.join(",")}`); await deleteAssetKeys(keys); },
  });
  assert.equal(result.status, "committed");
  assert.deepEqual(order, ["published", "delete:31:poster"]);
  assert.equal(await exists("31:poster"), false);
  assert.deepEqual(await readMediaCleanupJobs(), []);
});

test("02 — commit conserve le journal si la publication échoue", async () => {
  resetDb();
  let published = false;
  const locks = navigator.locks;
  const result = await publishWithMediaCleanupJournal({
    obsoleteKeys: ["32:video"], operation: "episode-update",
    commitMetadata: () => { published = true; return false; },
    readReferencedKeys: () => new Set(["32:video"]), deleteAssets: deleteAssetKeys,
  });
  assert.equal(result.status, "commit-failed");
  assert.equal(published, true);
  assert.equal((await readMediaCleanupJobs()).length, 1);
  assert.deepEqual(locks.events.map((entry) => entry[0]), ["acquire", "release"]);
});

test("03 — sans Web Locks, la publication est différée et aucun journal n'est créé", async () => {
  resetDb();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  let published = false;
  const result = await publishWithMediaCleanupJournal({
    obsoleteKeys: ["33:video"], operation: "title-update",
    commitMetadata: () => { published = true; return true; },
    readReferencedKeys: () => new Set(), deleteAssets: deleteAssetKeys,
  });
  assert.equal(result.status, "deferred");
  assert.equal(published, false);
  assert.deepEqual(await readMediaCleanupJobs(), []);
});

test("04 — un journal déjà écrit reprend après interruption de suppression", async () => {
  resetDb();
  await seed(ASSET_DB, ASSET_STORE, "34:video", new Blob(["old"]));
  await createMediaCleanupJob(["34:video"], "title-delete");
  const first = await processMediaCleanupJobs({
    readReferencedKeys: () => new Set(),
    deleteAssets: async () => { throw new Error("interruption synthétique"); },
  });
  assert.equal(first.status, "incomplete");
  assert.equal(await exists("34:video"), true);
  assert.equal((await readMediaCleanupJobs()).length, 1);

  const second = await processMediaCleanupJobs({ readReferencedKeys: () => new Set(), deleteAssets: deleteAssetKeys });
  assert.equal(second.status, "completed");
  assert.equal(await exists("34:video"), false);
  assert.deepEqual(await readMediaCleanupJobs(), []);
});

test("05 — clé partagée devient terminalement conservée", async () => {
  resetDb();
  await seed(ASSET_DB, ASSET_STORE, "35:video", new Blob(["shared"]));
  await createMediaCleanupJob(["35:video"], "title-delete");
  const result = await processMediaCleanupJobs({ readReferencedKeys: () => new Set(["35:video"]), deleteAssets: deleteAssetKeys });
  assert.equal(result.status, "completed");
  assert.equal(await exists("35:video"), true);
  assert.deepEqual(await readMediaCleanupJobs(), []);
});

test("06 — journal corrompu ne supprime aucune clé et reste présent", async () => {
  resetDb();
  await seed(ASSET_DB, ASSET_STORE, "36:video", new Blob(["keep"]));
  await seed("cinebox-cleanup", "jobs", "bad-job", { id: "bad-job", version: 99, keys: [{ key: "36:video", state: "pending" }] });
  const result = await processMediaCleanupJobs({ readReferencedKeys: () => new Set(), deleteAssets: deleteAssetKeys });
  assert.equal(result.status, "incomplete");
  assert.equal(result.results[0].status, "corrupt");
  assert.equal(await exists("36:video"), true);
  assert.equal((await readMediaCleanupJobs()).length, 1);
});

test("07 — catalogue illisible conserve chaque travail sans suppression", async () => {
  resetDb();
  await seed(ASSET_DB, ASSET_STORE, "37:video", new Blob(["keep"]));
  await createMediaCleanupJob(["37:video"], "title-delete");
  const result = await processMediaCleanupJobs({ readReferencedKeys: () => { throw new Error("recovery pending"); }, deleteAssets: deleteAssetKeys });
  assert.equal(result.status, "incomplete");
  assert.equal(await exists("37:video"), true);
  assert.equal((await readMediaCleanupJobs()).length, 1);
});

test("08 — une clé déjà absente se rejoue sans danger", async () => {
  resetDb();
  await createMediaCleanupJob(["38:already-gone"], "episode-update");
  const result = await processMediaCleanupJobs({ readReferencedKeys: () => new Set(), deleteAssets: deleteAssetKeys });
  assert.equal(result.status, "completed");
  assert.deepEqual(await readMediaCleanupJobs(), []);
});

test("09 — le verrou couvre la lecture des références et la suppression", async () => {
  resetDb();
  await seed(ASSET_DB, ASSET_STORE, "39:video", new Blob(["old"]));
  await createMediaCleanupJob(["39:video"], "title-delete");
  const events = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    request: async (_name, _options, callback) => {
      events.push("lock");
      const result = await callback();
      events.push("unlock");
      return result;
    },
  } } });
  const result = await processMediaCleanupJobs({
    readReferencedKeys: () => { events.push("read"); return new Set(); },
    deleteAssets: async (keys) => { events.push("delete"); await deleteAssetKeys(keys); },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(events, ["lock", "read", "delete", "unlock"]);
});

test("10 — échec d'écriture du journal interrompt la publication", async () => {
  resetDb();
  const factory = indexedDB;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open(name, version) { if (name === "cinebox-cleanup") throw new DOMException("quota", "QuotaExceededError"); return factory.open(name, version); } },
  });
  let published = false;
  const result = await publishWithMediaCleanupJournal({
    obsoleteKeys: ["40:poster"], operation: "title-update",
    commitMetadata: () => { published = true; return true; },
    readReferencedKeys: () => new Set(["40:poster"]), deleteAssets: deleteAssetKeys,
  });
  assert.equal(result.status, "journal-failed");
  assert.equal(published, false);
});

test("11 — altération d'une clé journalisée est détectée avant toute suppression", async () => {
  resetDb();
  await seed(ASSET_DB, ASSET_STORE, "41:video", new Blob(["keep"]));
  const job = await createMediaCleanupJob(["41:video"], "title-delete");
  job.keys[0].key = "41:other-video";
  await seed("cinebox-cleanup", "jobs", job.id, job);
  const result = await processMediaCleanupJobs({ readReferencedKeys: () => new Set(), deleteAssets: deleteAssetKeys });
  assert.equal(result.status, "incomplete");
  assert.equal(result.results[0].status, "corrupt");
  assert.equal(await exists("41:video"), true);
  assert.equal((await readMediaCleanupJobs()).length, 1);
});
