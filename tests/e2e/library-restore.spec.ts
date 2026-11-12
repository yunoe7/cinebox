import { expect, test, type Page } from "./fixtures";

const DB_NAME = "cinebox-assets";
const STORE_NAME = "files";

type AssetFixture = { key: string; contents: string; type?: string };
type TitleFixture = {
  id: number;
  name: string;
  kind: "Film" | "Série" | "Vidéo";
  year: number;
  genre: string;
  description: string;
  poster: string;
  progress: number;
  duration: string;
  [key: string]: unknown;
};

const makeTitle = (id: number, name: string, extra: Record<string, unknown> = {}): TitleFixture => ({
  id,
  name,
  kind: "Film",
  year: 2019,
  genre: "Archive synthétique",
  description: `Fixture E2E synthétique ${id}.`,
  poster: "",
  progress: 0,
  duration: "1 h 20",
  ...extra,
});

async function seedIsolatedBrowser(page: Page, titlesRaw: string, favoritesRaw: string, assets: AssetFixture[] = []) {
  await page.goto("/");
  await page.evaluate(async ({ titlesRaw, favoritesRaw, assets, dbName, storeName }) => {
    // These fixtures model a browser that has only the historical catalogue keys.
    // Remove the profile store bootstrapped by the initial empty page load.
    localStorage.removeItem("cinebox-profiles");
    localStorage.setItem("cinebox-titles", titlesRaw);
    localStorage.setItem("cinebox-favorites", favoritesRaw);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (assets.length) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        for (const asset of assets) {
          store.put(new Blob([asset.contents], { type: asset.type || "application/octet-stream" }), asset.key);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }
    db.close();
  }, { titlesRaw, favoritesRaw, assets, dbName: DB_NAME, storeName: STORE_NAME });
}

async function persistedSnapshot(page: Page) {
  return page.evaluate(async ({ dbName, storeName }) => {
    const titles = localStorage.getItem("cinebox-titles");
    const favorites = localStorage.getItem("cinebox-favorites");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const assets = await new Promise<Array<[string, string]>>((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      let keys: IDBValidKey[] | undefined;
      let values: Blob[] | undefined;
      const finish = async () => {
        if (!keys || !values) return;
        try {
          const pairs = await Promise.all(keys.map(async (key, index) =>
            [String(key), await values![index].text()] as [string, string],
          ));
          resolve(pairs.sort(([left], [right]) => left.localeCompare(right)));
        } catch (error) {
          reject(error);
        }
      };
      keysRequest.onerror = () => reject(keysRequest.error);
      keysRequest.onsuccess = () => { keys = keysRequest.result; void finish(); };
      valuesRequest.onerror = () => reject(valuesRequest.error);
      valuesRequest.onsuccess = () => { values = valuesRequest.result as Blob[]; void finish(); };
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    return { titles, favorites, assets };
  }, { dbName: DB_NAME, storeName: STORE_NAME });
}

async function installGetFailure(page: Page, failureKey: string, logKey = "__cineboxRestoreReadLog") {
  await page.addInitScript(({ failureKey, logKey }) => {
    const originalGet = IDBObjectStore.prototype.get;
    Object.defineProperty(window, logKey, { configurable: true, value: [] });
    IDBObjectStore.prototype.get = function (key: IDBValidKey) {
      if (key === failureKey) {
        (window as unknown as Record<string, string[]>)[logKey].push(`failed:${String(key)}`);
        throw new DOMException("Synthetic IndexedDB read failure", "UnknownError");
      }
      const request = originalGet.call(this, key);
      request.addEventListener("success", () => {
        (window as unknown as Record<string, string[]>)[logKey].push(`read:${String(key)}`);
      }, { once: true });
      return request;
    };
  }, { failureKey, logKey });
}

async function readRestoreLog(page: Page, logKey = "__cineboxRestoreReadLog") {
  return page.evaluate((key) => (window as unknown as Record<string, string[]>)[key] || [], logKey);
}

test("1 — restaure un catalogue historique valide sans réécrire les données", async ({ page }) => {
  const title = makeTitle(71001, "Archive valide", {
    currentTime: 412,
    progress: 37,
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Épisode historique", currentTime: 95, progress: 24 }] }],
  });
  const titlesRaw = JSON.stringify([title]);
  const favoritesRaw = JSON.stringify([71001]);
  await seedIsolatedBrowser(page, titlesRaw, favoritesRaw);

  await page.reload();

  await expect(page.getByRole("button", { name: "Ouvrir Archive valide" })).toBeVisible();
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();
  await expect(page.getByRole("button", { name: "Ouvrir Archive valide" })).toBeVisible();
  const saved = await persistedSnapshot(page);
  expect(saved.titles).toBe(titlesRaw);
  expect(saved.favorites).toBe(favoritesRaw);
});

test("2 — accepte un titre historique sans champs optionnels", async ({ page }) => {
  const title = makeTitle(71002, "Titre sans champs optionnels");
  const titlesRaw = JSON.stringify([title]);
  await seedIsolatedBrowser(page, titlesRaw, "[]");

  await page.reload();

  await expect(page.getByRole("button", { name: "Ouvrir Titre sans champs optionnels" })).toBeVisible();
  const saved = await persistedSnapshot(page);
  expect(saved.titles).toBe(titlesRaw);
  expect(JSON.parse(saved.titles!).map((item: Record<string, unknown>) => item.id)).toEqual([71002]);
});

test("3 — migre et affiche les favoris historiques sans réécrire leurs clés", async ({ page }) => {
  const titles = [makeTitle(71003, "Favori A"), makeTitle(71004, "Favori B")];
  const titlesRaw = JSON.stringify(titles);
  const favoritesRaw = JSON.stringify([71004, 71998]);
  await seedIsolatedBrowser(page, titlesRaw, favoritesRaw);

  await page.reload();
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();

  await expect(page.getByRole("button", { name: "Ouvrir Favori B" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Favori A" })).toHaveCount(0);
  const saved = await persistedSnapshot(page);
  expect(saved.favorites).toBe(favoritesRaw);
  const migratedProfile = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("cinebox-profiles") || "null");
    return store?.data?.[store.activeProfileId]?.favorites;
  });
  expect(migratedProfile).toEqual([71004, 71998]);
});

test("4 — charge les anciennes clés IndexedDB d'affiche, vidéo et épisode", async ({ page }) => {
  const title = makeTitle(71005, "Médias historiques", {
    kind: "Série",
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Épisode avec vidéo historique" }] }],
  });
  const titlesRaw = JSON.stringify([title]);
  await seedIsolatedBrowser(page, titlesRaw, "[]", [
    { key: "71005:poster", contents: "synthetic-poster" },
    { key: "71005:episode:1:1", contents: "synthetic-episode-video" },
  ]);

  await page.reload();
  const titleButton = page.getByRole("button", { name: "Ouvrir Médias historiques" });
  await expect(titleButton).toBeVisible();
  await titleButton.click();
  const details = page.getByRole("dialog");
  await details.getByRole("button", { name: "Saisons & épisodes" }).click();
  await details.getByRole("button", { name: /Épisode avec vidéo historique/ }).click();

  const video = page.locator("video.detail-video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.getAttribute("src")).toMatch(/^blob:/);
  await expect(details.locator(".episode-watch-title-card img")).toHaveAttribute("src", /^blob:/);
  const saved = await persistedSnapshot(page);
  expect(saved.titles).toBe(titlesRaw);
  expect(saved.assets).toEqual([
    ["71005:episode:1:1", "synthetic-episode-video"],
    ["71005:poster", "synthetic-poster"],
  ]);
});

test("5 — traite un média absent comme manquant sans effacer son titre", async ({ page }) => {
  const title = makeTitle(71006, "Vidéo absente", { videoAssetKey: "71006:video" });
  const titlesRaw = JSON.stringify([title]);
  const favoritesRaw = JSON.stringify([71006]);
  await seedIsolatedBrowser(page, titlesRaw, favoritesRaw);

  await page.reload();
  await page.getByRole("button", { name: "Ouvrir Vidéo absente" }).click();
  await expect(page.getByRole("dialog").getByText("Aucun fichier vidéo associé pour le moment.")).toBeVisible();
  const saved = await persistedSnapshot(page);
  expect(saved.titles).toBe(titlesRaw);
  expect(saved.favorites).toBe(favoritesRaw);
  expect(saved.assets).toEqual([]);
});

test("6 — distingue une erreur IndexedDB d'une clé média absente", async ({ page }) => {
  const title = makeTitle(71007, "Erreur de lecture", { posterAssetKey: "71007:poster" });
  const titlesRaw = JSON.stringify([title]);
  const favoritesRaw = JSON.stringify([71007]);
  await seedIsolatedBrowser(page, titlesRaw, favoritesRaw, [
    { key: "71007:poster", contents: "synthetic-protected-poster" },
  ]);
  const before = await persistedSnapshot(page);
  await installGetFailure(page, "71007:poster");

  await page.reload();

  await expect(page.getByText("La bibliothèque n’a pas pu être restaurée complètement. Aucune donnée ne sera remplacée.")).toBeVisible();
  expect(await readRestoreLog(page)).toContain("failed:71007:poster");
  expect(await persistedSnapshot(page)).toEqual(before);
});

test("7 — refuse un catalogue invalide sans le réinitialiser", async ({ page }) => {
  const titlesRaw = JSON.stringify([{
    id: 71008,
    name: "Catalogue incomplet",
    kind: "Film",
    year: 2018,
    genre: "Synthétique",
    description: "Fixture invalide : poster requis absent.",
    progress: 0,
    duration: "10 min",
  }]);
  const favoritesRaw = JSON.stringify([71008]);
  await seedIsolatedBrowser(page, titlesRaw, favoritesRaw);

  await page.reload();

  await expect(page.locator(".profile-storage-block")).toContainText("Les données historiques n’ont pas pu être lues");
  const saved = await persistedSnapshot(page);
  expect(saved.titles).toBe(titlesRaw);
  expect(saved.favorites).toBe(favoritesRaw);
  await expect(page.getByRole("button", { name: "Ouvrir Catalogue incomplet" })).toHaveCount(0);
});

test("8 — protège le catalogue si la restauration échoue après plusieurs lectures", async ({ page }) => {
  const title = makeTitle(71009, "Restauration interrompue", {
    posterAssetKey: "71009:poster",
    videoAssetKey: "71009:video",
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Épisode après les médias", videoAssetKey: "71009:episode:1:1" }] }],
  });
  const titlesRaw = JSON.stringify([title]);
  const favoritesRaw = JSON.stringify([71009]);
  await seedIsolatedBrowser(page, titlesRaw, favoritesRaw, [
    { key: "71009:poster", contents: "synthetic-poster-before-interruption" },
    { key: "71009:video", contents: "synthetic-video-before-interruption" },
    { key: "71009:episode:1:1", contents: "synthetic-episode-after-interruption" },
  ]);
  const before = await persistedSnapshot(page);
  await installGetFailure(page, "71009:episode:1:1");

  await page.reload();

  await expect(page.getByText("La bibliothèque n’a pas pu être restaurée complètement. Aucune donnée ne sera remplacée.")).toBeVisible();
  const reads = await readRestoreLog(page);
  expect(reads).toContain("read:71009:poster");
  expect(reads).toContain("read:71009:video");
  expect(reads).toContain("failed:71009:episode:1:1");
  expect(await persistedSnapshot(page)).toEqual(before);
});

test("9 — préserve exactement localStorage et IndexedDB après une erreur de restauration", async ({ page }) => {
  const title = makeTitle(71010, "Données à préserver", { posterAssetKey: "71010:poster" });
  const titlesRaw = JSON.stringify([title]);
  const favoritesRaw = JSON.stringify([71010, 71999]);
  await seedIsolatedBrowser(page, titlesRaw, favoritesRaw, [
    { key: "71010:poster", contents: "synthetic-exact-preservation" },
    { key: "71999:unrelated", contents: "synthetic-unrelated-asset" },
  ]);
  const before = await persistedSnapshot(page);
  await installGetFailure(page, "71010:poster");

  await page.reload();

  await expect(page.getByText("La bibliothèque n’a pas pu être restaurée complètement. Aucune donnée ne sera remplacée.")).toBeVisible();
  const after = await persistedSnapshot(page);
  expect(after).toEqual(before);
  expect(after.titles).toBe(titlesRaw);
  expect(after.favorites).toBe(favoritesRaw);
});
