import { expect, test, type Page } from "@playwright/test";

const ASSET_DB = "cinebox-assets";
const ASSET_STORE = "files";
const titleId = 74901;
const posterKey = `${titleId}:poster:v:synthetic`;
const videoKey = `${titleId}:video:v:synthetic`;

declare global {
  interface Window {
    __cineboxBlobCreated: string[];
    __cineboxBlobRevoked: string[];
    __cineboxFailBlobCreateAt?: number;
  }
}

const captureBlobUrls = () => {
  const originalCreate = URL.createObjectURL.bind(URL);
  const originalRevoke = URL.revokeObjectURL.bind(URL);
  window.__cineboxBlobCreated = [];
  window.__cineboxBlobRevoked = [];
  let createCount = 0;
  URL.createObjectURL = (blob) => {
    createCount += 1;
    if (createCount === window.__cineboxFailBlobCreateAt) throw new Error("Synthetic Blob URL creation failure");
    const url = originalCreate(blob);
    window.__cineboxBlobCreated.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    window.__cineboxBlobRevoked.push(url);
    originalRevoke(url);
  };
};

async function seedLibrary(page: Page, failAt?: number) {
  await page.addInitScript(captureBlobUrls);
  if (failAt) await page.addInitScript((count) => { window.__cineboxFailBlobCreateAt = count; }, failAt);
  await page.goto("/");
  await page.evaluate(async ({ id, posterKey, videoKey, dbName, storeName }) => {
    localStorage.setItem("cinebox-titles", JSON.stringify([{
      id, name: "Cycle Blob synthétique", kind: "Film", year: 2025,
      genre: "Fixture", description: "Données de test isolées.", poster: "",
      progress: 0, duration: "12 secondes", posterAssetKey: posterKey,
      videoAssetKey: videoKey,
    }]));
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
  }, { id: titleId, posterKey, videoKey, dbName: ASSET_DB, storeName: ASSET_STORE });
  await page.reload();
}

test("les URL restaurées restent valides dans le détail et le lecteur puis sont libérées après suppression", async ({ page }) => {
  await seedLibrary(page);
  await expect(page.getByRole("button", { name: "Ouvrir Cycle Blob synthétique" })).toBeVisible();
  const created = await page.evaluate(() => [...window.__cineboxBlobCreated]);
  expect(created).toHaveLength(2);
  expect(created.every((url) => url.startsWith("blob:"))).toBe(true);

  await page.getByRole("button", { name: "Ouvrir Cycle Blob synthétique" }).click();
  const details = page.getByRole("dialog");
  await details.getByRole("button", { name: "Lecture" }).click();
  await expect(details.locator("video.detail-video")).toHaveAttribute("src", created[1]);
  await details.getByRole("button", { name: "Fermer les détails" }).click();
  await expect(details).toHaveCount(0);
  expect(await page.evaluate(() => window.__cineboxBlobRevoked)).toEqual([]);

  await page.locator(".sidebar .nav-item").filter({ hasText: "Administration" }).click();
  await page.locator(".admin-section-nav").getByRole("button", { name: "Films" }).click();
  await page.getByRole("button", { name: "Actions pour Cycle Blob synthétique" }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByRole("button", { name: "Ouvrir Cycle Blob synthétique" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => [...window.__cineboxBlobRevoked].sort())).toEqual([...created].sort());
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cinebox-titles") || "[]"))).toEqual([]);
});

test("une restauration interrompue révoque toutes les URL provisoires réellement créées", async ({ page }) => {
  await seedLibrary(page, 2);
  await expect(page.getByRole("status").filter({ hasText: "Bibliothèque protégée" })).toBeVisible();
  const created = await page.evaluate(() => [...window.__cineboxBlobCreated]);
  const revoked = await page.evaluate(() => [...window.__cineboxBlobRevoked]);
  expect(created).toHaveLength(1);
  expect(revoked).toEqual(created);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cinebox-titles") || "[]"))).toHaveLength(1);
});
