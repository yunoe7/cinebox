import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "./fixtures";

const ASSET_DB = "cinebox-assets";
const ASSET_STORE = "files";
const titleId = 74951;
const posterKey = `${titleId}:poster:v:export`;
const videoKey = `${titleId}:video:v:export`;

const legacyTitle = {
  id: titleId,
  name: "Export Legacy",
  kind: "Film",
  year: 2024,
  genre: "Drame",
  description: "Fiche locale synthétique pour valider l’export.",
  poster: "",
  backdrop: "",
  progress: 0,
  duration: "1 h 20",
  posterAssetKey: posterKey,
  videoAssetKey: videoKey,
};

async function seedLegacyLibrary(page: Page) {
  await page.goto("/");
  await page.evaluate(async ({ title, posterKey, videoKey, dbName, storeName }) => {
    localStorage.setItem("cinebox-titles", JSON.stringify([title]));
    localStorage.setItem("cinebox-favorites", "[]");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      store.put(new Blob(["synthetic poster bytes"], { type: "image/png" }), posterKey);
      store.put(new Blob(["synthetic video bytes"], { type: "video/webm" }), videoKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, { title: legacyTitle, posterKey, videoKey, dbName: ASSET_DB, storeName: ASSET_STORE });
  await page.reload();
}

async function readIndexedDbKeys(page: Page) {
  return page.evaluate(async ({ dbName, storeName }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return keys.map(String).sort();
  }, { dbName: ASSET_DB, storeName: ASSET_STORE });
}

async function readLocalStorageSnapshot(page: Page) {
  return page.evaluate(() => ({
    titles: localStorage.getItem("cinebox-titles"),
    favorites: localStorage.getItem("cinebox-favorites"),
  }));
}

test("l’export legacy télécharge un manifeste et les médias sans supprimer aucune donnée", async ({ page }) => {
  await seedLegacyLibrary(page);
  await page.locator(".sidebar .nav-item").filter({ hasText: "Administration" }).click();
  await expect(page.locator(".admin-legacy-row").filter({ hasText: legacyTitle.name })).toHaveCount(1);

  const beforeStorage = await readLocalStorageSnapshot(page);
  const beforeKeys = await readIndexedDbKeys(page);
  expect(beforeKeys).toEqual([posterKey, videoKey].sort());

  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));

  await page.getByRole("button", { name: "Exporter la bibliothèque locale" }).click();
  await expect(page.locator(".app-toast")).toContainText("Export local terminé");
  await expect.poll(() => downloads.length).toBe(3);

  const manifestDownload = downloads.find((download) => download.suggestedFilename().endsWith(".json"));
  expect(manifestDownload).toBeTruthy();
  const manifestPath = await manifestDownload!.path();
  const manifest = JSON.parse(await readFile(manifestPath!, "utf8"));
  expect(manifest.format).toBe("cinebox-legacy-export");
  expect(manifest.counts).toMatchObject({ titles: 1, assets: 2, found: 2, missing: 0, unreadable: 0 });
  expect(manifest.titles[0].name).toBe(legacyTitle.name);
  expect(manifest.assets.map((asset: { key: string }) => asset.key).sort()).toEqual([posterKey, videoKey].sort());
  expect(manifest.assets.every((asset: { status: string }) => asset.status === "found")).toBe(true);

  const mediaFilenames = downloads
    .map((download) => download.suggestedFilename())
    .filter((filename) => !filename.endsWith(".json"));
  expect(mediaFilenames).toHaveLength(2);
  expect(mediaFilenames[0]).toMatch(/^cinebox-media-001-.*\.png$/);
  expect(mediaFilenames[1]).toMatch(/^cinebox-media-002-.*\.webm$/);

  // Exporting is read-only: local storage and IndexedDB must be untouched.
  expect(await readLocalStorageSnapshot(page)).toEqual(beforeStorage);
  expect(await readIndexedDbKeys(page)).toEqual(beforeKeys);
});
