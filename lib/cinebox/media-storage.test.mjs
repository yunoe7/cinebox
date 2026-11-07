import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { cleanupUnpublishedAssets, commitMetadataThenCleanup, stageAssets } from "./media-lifecycle.mjs";
import { writeLocalJson } from "./local-storage.mjs";
import { deleteAssetKeys, readAsset, saveVersionedAsset } from "./storage.ts";

const DB_NAME = "cinebox-assets";
const STORE_NAME = "files";

function resetIndexedDb() {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value: new IDBFactory(),
  });
}

async function seed(key, text) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(new Blob([text]), key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

async function content(key) {
  const result = await readAsset(key);
  return result.status === "found" ? result.blob.text() : undefined;
}

test("01 — les clés historiques restent lisibles", async () => {
  resetIndexedDb();
  await seed("41:poster", "legacy poster");

  const result = await readAsset("41:poster");
  assert.equal(result.status, "found");
  assert.equal(await result.blob.text(), "legacy poster");
});

test("02 — l'ajout crée une clé versionnée sans toucher à la clé historique", async () => {
  resetIndexedDb();
  await seed("41:video", "ancienne vidéo");

  const staged = await stageAssets([
    { slot: "poster", baseKey: "41:poster", blob: new Blob(["new poster"]) },
    { slot: "video", baseKey: "41:video", blob: new Blob(["nouvelle vidéo"]) },
    { slot: "episode", baseKey: "41:episode:1:1", blob: new Blob(["new episode"]) },
  ], saveVersionedAsset);
  assert.equal(staged.status, "ready");
  assert.match(staged.references.video, /^41:video:v:/);
  assert.equal(await content("41:video"), "ancienne vidéo");
  assert.equal(await content(staged.references.poster), "new poster");
  assert.equal(await content(staged.references.video), "nouvelle vidéo");
  assert.equal(await content(staged.references.episode), "new episode");
});

test("03 — le remplacement conserve l'ancien Blob jusqu'au commit des métadonnées", async () => {
  resetIndexedDb();
  await seed("5:poster", "old");
  const staged = await stageAssets([{ slot: "poster", baseKey: "5:poster", blob: new Blob(["new"]) }], saveVersionedAsset);
  assert.equal(staged.status, "ready");
  const nextKey = staged.references.poster;

  const result = await commitMetadataThenCleanup({
    commitMetadata: async () => {
      assert.equal(await content("5:poster"), "old");
      assert.equal(await content(nextKey), "new");
      return true;
    },
    obsoleteKeys: ["5:poster"],
    referencedKeys: new Set([nextKey]),
    deleteAssets: deleteAssetKeys,
  });
  assert.equal(result.status, "committed");
  assert.equal(await content("5:poster"), undefined);
  assert.equal(await content(nextKey), "new");
});

test("04 — un échec de staging n'efface pas le média précédent", async () => {
  resetIndexedDb();
  await seed("6:video", "old");
  const staged = await stageAssets([{ slot: "video", baseKey: "6:video", blob: new Blob(["new"]) }], async () => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  assert.equal(staged.status, "failed");
  assert.equal(await content("6:video"), "old");
});

test("05 — un échec de sauvegarde des métadonnées conserve l'ancien Blob", async () => {
  resetIndexedDb();
  await seed("7:poster", "old");
  const staged = await stageAssets([{ slot: "poster", baseKey: "7:poster", blob: new Blob(["new"]) }], saveVersionedAsset);
  const newKey = staged.references.poster;
  const result = await commitMetadataThenCleanup({
    commitMetadata: () => false,
    obsoleteKeys: ["7:poster"],
    referencedKeys: new Set([newKey]),
    deleteAssets: deleteAssetKeys,
  });
  assert.equal(result.status, "commit-failed");
  assert.equal(await content("7:poster"), "old");
  assert.equal(await content(newKey), "new");
});

test("06 — un lot partiellement préparé n'est jamais publié", async () => {
  resetIndexedDb();
  await seed("8:video", "old");
  const staged = await stageAssets([
    { slot: "poster", baseKey: "8:poster", blob: new Blob(["poster"]) },
    { slot: "video", baseKey: "8:video", blob: new Blob(["video"]) },
  ], async (key, blob) => {
    if (key.endsWith(":video")) throw new Error("write failed");
    return saveVersionedAsset(key, blob);
  });
  assert.equal(staged.status, "failed");
  assert.equal(staged.references.video, undefined);
  assert.ok(staged.references.poster);
  assert.equal(await content("8:video"), "old");
});

test("07 — interruption après staging laisse l'ancien média et le nouveau récupérables", async () => {
  resetIndexedDb();
  await seed("9:poster", "old");
  const staged = await stageAssets([{ slot: "poster", baseKey: "9:poster", blob: new Blob(["staged"]) }], saveVersionedAsset);
  assert.equal(await content("9:poster"), "old");
  assert.equal(await content(staged.references.poster), "staged");
});

test("08 — un nettoyage en échec garde la nouvelle référence et les anciens Blobs", async () => {
  resetIndexedDb();
  await seed("10:video", "old");
  const nextKey = await saveVersionedAsset("10:video", new Blob(["new"]));
  const result = await commitMetadataThenCleanup({
    commitMetadata: () => true,
    obsoleteKeys: ["10:video"],
    referencedKeys: new Set([nextKey]),
    deleteAssets: async () => { throw new Error("delete failed"); },
  });
  assert.equal(result.status, "cleanup-failed");
  assert.equal(await content("10:video"), "old");
  assert.equal(await content(nextKey), "new");
});

test("09 — suppression de titre : échec du commit signifie aucun nettoyage", async () => {
  resetIndexedDb();
  await seed("11:video", "title media");
  let deleteCalled = false;
  const result = await commitMetadataThenCleanup({
    commitMetadata: () => false,
    obsoleteKeys: ["11:video"],
    referencedKeys: new Set(),
    deleteAssets: async (keys) => { deleteCalled = true; await deleteAssetKeys(keys); },
  });
  assert.equal(result.status, "commit-failed");
  assert.equal(deleteCalled, false);
  assert.equal(await content("11:video"), "title media");
});

test("10 — après confirmation de suppression, le nettoyage exact est autorisé", async () => {
  resetIndexedDb();
  await seed("12:video", "title media");
  const order = [];
  const result = await commitMetadataThenCleanup({
    commitMetadata: () => { order.push("metadata"); return true; },
    obsoleteKeys: ["12:video"],
    referencedKeys: new Set(),
    deleteAssets: async (keys) => { order.push("assets"); await deleteAssetKeys(keys); },
  });
  assert.deepEqual(order, ["metadata", "assets"]);
  assert.equal(result.status, "committed");
  assert.equal(await content("12:video"), undefined);
});

test("11 — une lecture en erreur rejette, une clé réellement absente est distincte", async () => {
  resetIndexedDb();
  assert.deepEqual(await readAsset("missing:key"), { status: "missing" });
  globalThis.indexedDB = { open() { throw new DOMException("blocked", "SecurityError"); } };
  await assert.rejects(readAsset("legacy:key"), /blocked/);
});

test("12 — le nettoyage par clés exactes ne touche ni les préfixes voisins ni les clés inconnues", async () => {
  resetIndexedDb();
  await seed("1:poster", "one");
  await seed("10:poster", "ten");
  await seed("1:untracked", "unknown");
  await deleteAssetKeys(["1:poster"]);

  assert.equal(await content("1:poster"), undefined);
  assert.equal(await content("10:poster"), "ten");
  assert.equal(await content("1:untracked"), "unknown");
});

test("13 — remplacer une vidéo d'épisode conserve sa miniature référencée", async () => {
  resetIndexedDb();
  const videoKey = "13:episode:1:1";
  const thumbnailKey = `${videoKey}:thumbnail`;
  await seed(videoKey, "old episode");
  await seed(thumbnailKey, "episode thumbnail");
  const staged = await stageAssets([{ slot: "episodeVideo", baseKey: videoKey, blob: new Blob(["new episode"]) }], saveVersionedAsset);
  const newKey = staged.references.episodeVideo;
  const result = await commitMetadataThenCleanup({
    commitMetadata: () => true,
    obsoleteKeys: [videoKey, thumbnailKey],
    referencedKeys: new Set([newKey, thumbnailKey]),
    deleteAssets: deleteAssetKeys,
  });
  assert.equal(result.status, "committed");
  assert.equal(await content(newKey), "new episode");
  assert.equal(await content(videoKey), undefined);
  assert.equal(await content(thumbnailKey), "episode thumbnail");
});

test("14 — suppression interrompue après le commit garde les assets et permet une reprise", async () => {
  resetIndexedDb();
  await seed("14:video", "title media");
  let titlePresent = true;
  const interrupted = await commitMetadataThenCleanup({
    commitMetadata: () => { titlePresent = false; return true; },
    obsoleteKeys: ["14:video"],
    referencedKeys: new Set(),
    deleteAssets: async () => { throw new Error("interrupted before cleanup"); },
  });
  assert.equal(titlePresent, false);
  assert.equal(interrupted.status, "cleanup-failed");
  assert.equal(await content("14:video"), "title media");

  await deleteAssetKeys(interrupted.retiredKeys);
  assert.equal(await content("14:video"), undefined);
});

test("15 — un staging partiel ne publie aucun actif et nettoie les nouvelles clés", async () => {
  resetIndexedDb();
  await seed("15:video", "ancienne vidéo");
  const storedTitles = [{ id: 15, posterAssetKey: "15:poster:old", videoAssetKey: "15:video" }];
  const storage = new Map([["cinebox-titles", JSON.stringify(storedTitles)]]);

  const staged = await stageAssets([
    { slot: "poster", baseKey: "15:poster", blob: new Blob(["nouvelle affiche"]) },
    { slot: "video", baseKey: "15:video", blob: new Blob(["nouvelle vidéo"]) },
  ], async (key, blob) => {
    if (key === "15:video") throw new Error("échec synthétique du second staging");
    return saveVersionedAsset(key, blob);
  });

  assert.equal(staged.status, "failed");
  assert.ok(staged.references.poster);
  assert.equal(staged.references.video, undefined);
  assert.deepEqual(JSON.parse(storage.get("cinebox-titles")), storedTitles);
  assert.equal(await content("15:video"), "ancienne vidéo");
  const cleanup = await cleanupUnpublishedAssets(Object.values(staged.references), () => new Set(["15:poster:old", "15:video"]), deleteAssetKeys);
  assert.equal(cleanup.status, "cleaned");
  assert.equal(await content(staged.references.poster), undefined);
  assert.notEqual(storedTitles[0].posterAssetKey, staged.references.poster);
});

test("16 — échec localStorage après staging garde les anciennes métadonnées et clés", async () => {
  resetIndexedDb();
  await seed("16:poster", "ancienne affiche");
  const oldTitles = [{ id: 16, posterAssetKey: "16:poster" }];
  const storage = {
    getItem(key) { return key === "cinebox-titles" ? JSON.stringify(oldTitles) : null; },
    setItem() { throw new DOMException("quota synthétique", "QuotaExceededError"); },
  };
  const staged = await stageAssets([{ slot: "poster", baseKey: "16:poster", blob: new Blob(["nouvelle affiche"]) }], saveVersionedAsset);
  assert.equal(staged.status, "ready");
  let cleanupCalled = false;

  const publication = await commitMetadataThenCleanup({
    commitMetadata: () => writeLocalJson(() => storage, "cinebox-titles", [{ id: 16, posterAssetKey: staged.references.poster }]).ok,
    obsoleteKeys: ["16:poster"],
    referencedKeys: new Set([staged.references.poster]),
    deleteAssets: async (keys) => { cleanupCalled = true; await deleteAssetKeys(keys); },
  });

  assert.equal(publication.status, "commit-failed");
  assert.equal(cleanupCalled, false);
  assert.deepEqual(JSON.parse(storage.getItem("cinebox-titles")), oldTitles);
  assert.equal(await content("16:poster"), "ancienne affiche");
  const stagedCleanup = await cleanupUnpublishedAssets(Object.values(staged.references), () => new Set(["16:poster"]), deleteAssetKeys);
  assert.equal(stagedCleanup.status, "cleaned");
  assert.equal(await content(staged.references.poster), undefined);
});

test("17 — échec du nettoyage après publication garde les deux Blobs et la nouvelle référence", async () => {
  resetIndexedDb();
  await seed("17:video", "ancienne vidéo");
  const storage = new Map([["cinebox-titles", JSON.stringify([{ id: 17, videoAssetKey: "17:video" }])]]);
  const staged = await stageAssets([{ slot: "video", baseKey: "17:video", blob: new Blob(["nouvelle vidéo"]) }], saveVersionedAsset);
  const publishedTitles = [{ id: 17, videoAssetKey: staged.references.video }];

  const publication = await commitMetadataThenCleanup({
    commitMetadata: () => { storage.set("cinebox-titles", JSON.stringify(publishedTitles)); return true; },
    obsoleteKeys: ["17:video"],
    referencedKeys: new Set([staged.references.video]),
    deleteAssets: async () => { throw new Error("échec synthétique du nettoyage"); },
  });

  assert.equal(publication.status, "cleanup-failed");
  assert.deepEqual(JSON.parse(storage.get("cinebox-titles")), publishedTitles);
  assert.equal(await content("17:video"), "ancienne vidéo");
  assert.equal(await content(staged.references.video), "nouvelle vidéo");
});

test("18 — une clé encore référencée par un autre titre n'est pas nettoyée", async () => {
  resetIndexedDb();
  await seed("18:shared-video", "vidéo partagée");
  await seed("18:poster", "affiche du titre supprimé");
  const remainingTitles = [{ id: 180, videoAssetKey: "18:shared-video" }];
  const obsoleteKeys = ["18:shared-video", "18:poster"];
  const referencedKeys = new Set(remainingTitles.map((title) => title.videoAssetKey));

  const publication = await commitMetadataThenCleanup({
    commitMetadata: () => true,
    obsoleteKeys,
    referencedKeys,
    deleteAssets: deleteAssetKeys,
  });

  assert.equal(publication.status, "committed");
  assert.deepEqual(publication.retiredKeys, ["18:poster"]);
  assert.equal(await content("18:shared-video"), "vidéo partagée");
  assert.equal(await content("18:poster"), undefined);
});

test("19 — staging partiel de série nettoie toutes les nouvelles clés non référencées", async () => {
  resetIndexedDb();
  const oldEpisodeKey = "19:episode:1:1";
  const oldThumbnailKey = `${oldEpisodeKey}:thumbnail`;
  await seed(oldEpisodeKey, "ancienne vidéo série");
  await seed(oldThumbnailKey, "ancienne miniature série");
  const beforeTitles = [{
    id: 19,
    kind: "Série",
    seasons: [{ number: 1, episodes: [
      { number: 1, title: "Épisode existant", videoAssetKey: oldEpisodeKey, thumbnailAssetKey: oldThumbnailKey, currentTime: 74, progress: 61 },
    ] }],
  }];
  const storage = new Map([["cinebox-titles", JSON.stringify(beforeTitles)]]);
  const staged = await stageAssets([
    { slot: "episode:1:2", baseKey: "19:episode:1:2", blob: new Blob(["nouvel épisode deux"]) },
    { slot: "episode:1:3", baseKey: "19:episode:1:3", blob: new Blob(["nouvel épisode trois"]) },
    { slot: "episode:1:4", baseKey: "19:episode:1:4", blob: new Blob(["nouvel épisode quatre"]) },
  ], async (key, blob) => {
    if (key.endsWith(":4")) throw new Error("échec synthétique de l'épisode quatre");
    return saveVersionedAsset(key, blob);
  });
  assert.equal(staged.status, "failed");
  assert.deepEqual(Object.keys(staged.references).sort(), ["episode:1:2", "episode:1:3"]);

  const cleanup = await cleanupUnpublishedAssets(Object.values(staged.references), () => new Set([oldEpisodeKey, oldThumbnailKey]), deleteAssetKeys);

  assert.equal(cleanup.status, "cleaned");
  for (const key of Object.values(staged.references)) assert.equal(await content(key), undefined);
  assert.deepEqual(JSON.parse(storage.get("cinebox-titles")), beforeTitles);
  assert.equal(await content(oldEpisodeKey), "ancienne vidéo série");
  assert.equal(await content(oldThumbnailKey), "ancienne miniature série");
  assert.deepEqual(beforeTitles[0].seasons[0].episodes[0], {
    number: 1, title: "Épisode existant", videoAssetKey: oldEpisodeKey,
    thumbnailAssetKey: oldThumbnailKey, currentTime: 74, progress: 61,
  });
});

test("20 — staging partiel vidéo et miniature d'épisode conserve association et progression", async () => {
  resetIndexedDb();
  const videoKey = "20:episode:1:1";
  const thumbnailKey = `${videoKey}:thumbnail`;
  await seed(videoKey, "ancienne vidéo épisode");
  await seed(thumbnailKey, "ancienne miniature épisode");
  const beforeTitles = [{ id: 20, seasons: [{ number: 1, episodes: [
    { number: 1, title: "Épisode un", videoAssetKey: videoKey, thumbnailAssetKey: thumbnailKey, currentTime: 82, progress: 73 },
  ] }] }];
  const staged = await stageAssets([
    { slot: "episode", baseKey: videoKey, blob: new Blob(["nouvelle vidéo épisode"]) },
    { slot: "thumbnail", baseKey: thumbnailKey, blob: new Blob(["nouvelle miniature épisode"]) },
  ], async (key, blob) => {
    if (key === thumbnailKey) throw new Error("échec synthétique de miniature");
    return saveVersionedAsset(key, blob);
  });
  assert.equal(staged.status, "failed");
  assert.ok(staged.references.episode);
  assert.equal(staged.references.thumbnail, undefined);

  const cleanup = await cleanupUnpublishedAssets(Object.values(staged.references), () => new Set([videoKey, thumbnailKey]), deleteAssetKeys);

  assert.equal(cleanup.status, "cleaned");
  assert.equal(await content(staged.references.episode), undefined);
  assert.equal(await content(videoKey), "ancienne vidéo épisode");
  assert.equal(await content(thumbnailKey), "ancienne miniature épisode");
  assert.deepEqual(beforeTitles[0].seasons[0].episodes[0], {
    number: 1, title: "Épisode un", videoAssetKey: videoKey,
    thumbnailAssetKey: thumbnailKey, currentTime: 82, progress: 73,
  });
});

test("21 — le nettoyage déduplique et conserve chaque nouvelle clé encore référencée", async () => {
  resetIndexedDb();
  const sharedKey = await saveVersionedAsset("21:video", new Blob(["nouvelle vidéo partagée"]));
  const unreferencedKey = await saveVersionedAsset("21:poster", new Blob(["nouvelle affiche non publiée"]));
  const deletedBatches = [];

  const cleanup = await cleanupUnpublishedAssets(
    [sharedKey, sharedKey, unreferencedKey],
    () => new Set([sharedKey]),
    async (keys) => { deletedBatches.push(keys); await deleteAssetKeys(keys); },
  );

  assert.equal(cleanup.status, "cleaned");
  assert.deepEqual(deletedBatches, [[unreferencedKey]]);
  assert.deepEqual(cleanup.retainedKeys, [sharedKey]);
  assert.equal(await content(sharedKey), "nouvelle vidéo partagée");
  assert.equal(await content(unreferencedKey), undefined);
});

test("22 — une lecture des références impossible ne supprime aucune clé", async () => {
  resetIndexedDb();
  const candidateKey = await saveVersionedAsset("22:video", new Blob(["staged video"]));
  let deleteCalled = false;
  const readers = [
    async () => { throw new Error("catalogue illisible"); },
    async () => ["not-a-reference-set"],
  ];
  for (const readReferences of readers) {
    const cleanup = await cleanupUnpublishedAssets([candidateKey], readReferences, async (keys) => {
      deleteCalled = true;
      await deleteAssetKeys(keys);
    });
    assert.equal(cleanup.status, "references-unavailable");
  }
  assert.equal(deleteCalled, false);
  assert.equal(await content(candidateKey), "staged video");
});

test("23 — un échec de nettoyage est explicite et conserve les anciennes données", async () => {
  resetIndexedDb();
  const oldKey = "23:video";
  await seed(oldKey, "ancienne vidéo intacte");
  const oldTitles = [{ id: 23, videoAssetKey: oldKey, currentTime: 55, progress: 44 }];
  const storage = new Map([["cinebox-titles", JSON.stringify(oldTitles)]]);
  const stagedKey = await saveVersionedAsset(oldKey, new Blob(["nouvelle vidéo non publiée"]));

  const cleanup = await cleanupUnpublishedAssets([stagedKey], () => new Set([oldKey]), async () => {
    throw new Error("échec IndexedDB de nettoyage");
  });

  assert.equal(cleanup.status, "cleanup-failed");
  assert.deepEqual(cleanup.unresolvedKeys, [stagedKey]);
  assert.deepEqual(JSON.parse(storage.get("cinebox-titles")), oldTitles);
  assert.equal(await content(oldKey), "ancienne vidéo intacte");
  assert.equal(await content(stagedKey), "nouvelle vidéo non publiée");
});
