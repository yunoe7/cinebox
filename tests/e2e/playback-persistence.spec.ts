import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { rm } from "node:fs/promises";

const DB_NAME = "cinebox-assets";
const STORE_NAME = "files";

type StoredAsset = { key: string; contents: string };
type StoredTitle = {
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

function film(id: number, name: string, fields: Record<string, unknown> = {}): StoredTitle {
  return {
    id,
    name,
    kind: "Film",
    year: 2020,
    genre: "Synthétique",
    description: `Donnée E2E synthétique ${id}.`,
    poster: "",
    progress: 0,
    duration: "100 secondes",
    ...fields,
  };
}

function series(id: number, fields: Record<string, unknown> = {}): StoredTitle {
  return {
    ...film(id, `Série synthétique ${id}`),
    kind: "Série",
    duration: "1 saison",
    seasons: [{
      number: 1,
      episodes: [
        { number: 1, title: "Épisode 1", videoAssetKey: `${id}:episode:1:1`, currentTime: 0, progress: 0 },
        { number: 2, title: "Épisode 2", videoAssetKey: `${id}:episode:1:2`, currentTime: 0, progress: 0 },
      ],
    }],
    ...fields,
  };
}

async function installSyntheticMediaControls(context: BrowserContext) {
  await context.addInitScript(() => {
    // Keep the rendered component and its React event handlers, but do not claim
    // that the synthetic Blob is a decodable video or that playback occurred.
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  });
}

async function seedBrowser(page: Page, titles: StoredTitle[], favorites: number[], assets: StoredAsset[] = []) {
  await installSyntheticMediaControls(page.context());
  await page.goto("/");
  await page.evaluate(async ({ titles, favorites, assets, dbName, storeName }) => {
    localStorage.setItem("cinebox-titles", JSON.stringify(titles));
    localStorage.setItem("cinebox-favorites", JSON.stringify(favorites));
    // The first navigation creates an empty default profile. Remove only that
    // isolated test profile so reload exercises the intended legacy migration.
    localStorage.removeItem("cinebox-profiles");
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
        for (const asset of assets) {
          transaction.objectStore(storeName).put(new Blob([asset.contents], { type: "video/webm" }), asset.key);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }
    db.close();
  }, { titles, favorites, assets, dbName: DB_NAME, storeName: STORE_NAME });
  await page.reload();
}

async function openFilmPlayer(page: Page, title: string) {
  await page.getByRole("button", { name: `Ouvrir ${title}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^(Lecture|Reprendre)$/ }).click();
  const video = page.locator("video.detail-video");
  await expect(video).toBeVisible();
  return { dialog, video };
}

async function openEpisodePlayer(page: Page, title: string, episodeTitle: string) {
  await page.getByRole("button", { name: `Ouvrir ${title}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Saisons & épisodes" }).click();
  await dialog.locator(".detail-episode-main").filter({ hasText: episodeTitle }).click();
  const video = page.locator("video.detail-video");
  await expect(video).toBeVisible();
  return { dialog, video };
}

async function setMediaState(page: Page, { duration, currentTime, event }: { duration: number; currentTime: number; event?: string }) {
  await page.locator("video.detail-video").evaluate((element, state) => {
    const video = element as HTMLVideoElement;
    let position = state.currentTime;
    Object.defineProperty(video, "duration", { configurable: true, get: () => state.duration });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => position,
      set: (value: number) => { position = value; },
    });
    if (state.event) video.dispatchEvent(new Event(state.event, { bubbles: true }));
  }, { duration, currentTime, event });
}

async function dispatchMediaEvent(page: Page, event: string, currentTime: number, duration = 100) {
  await setMediaState(page, { duration, currentTime, event });
}

async function readTitles(page: Page): Promise<StoredTitle[]> {
  return page.evaluate(() => {
    const titles = JSON.parse(localStorage.getItem("cinebox-titles") || "[]") as StoredTitle[];
    const rawProfiles = localStorage.getItem("cinebox-profiles");
    if (!rawProfiles) return titles;
    const store = JSON.parse(rawProfiles) as {
      activeProfileId?: string;
      data?: Record<string, {
        playback?: Record<string, { assetKey?: string; currentTime: number; progress: number; episodes: Record<string, { assetKey?: string; currentTime: number; progress: number }> }>;
        viewCounts?: Record<string, number>;
      }>;
    };
    const profile = store.activeProfileId ? store.data?.[store.activeProfileId] : undefined;
    if (!profile) return titles;
    return titles.map((title) => {
      const playback = profile.playback?.[String(title.id)];
      const titleAssetKey = String(title.videoAssetKey || `${title.id}:video`);
      const validPlayback = playback && (!playback.assetKey || playback.assetKey === titleAssetKey) ? playback : undefined;
      const seasons = Array.isArray(title.seasons) ? (title.seasons as Array<{ number: number; episodes: Array<Record<string, unknown>> }>).map((season) => ({
        ...season,
        episodes: season.episodes.map((episode) => {
          const key = `${season.number}:${episode.number}`;
          const saved = playback?.episodes?.[key];
          const episodeAssetKey = String(episode.videoAssetKey || `${title.id}:episode:${key}`);
          return saved && (!saved.assetKey || saved.assetKey === episodeAssetKey)
            ? { ...episode, currentTime: saved.currentTime, progress: saved.progress }
            : { ...episode, currentTime: 0, progress: 0 };
        }),
      })) : [];
      return {
        ...title,
        backdrop: title.backdrop ?? "",
        seasons,
        currentTime: validPlayback?.currentTime ?? 0,
        progress: validPlayback?.progress ?? 0,
        viewCount: profile.viewCounts?.[String(title.id)] ?? 0,
      };
    });
  });
}

async function readStorageSnapshot(page: Page, includeProfiles = false) {
  return page.evaluate(async ({ dbName, storeName, includeProfiles }) => {
    const titles = localStorage.getItem("cinebox-titles");
    const favorites = localStorage.getItem("cinebox-favorites");
    const profiles = includeProfiles ? localStorage.getItem("cinebox-profiles") : undefined;
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
          const pairs = await Promise.all(keys.map(async (key, index) => [String(key), await values![index].text()] as [string, string]));
          resolve(pairs.sort(([a], [b]) => a.localeCompare(b)));
        } catch (error) { reject(error); }
      };
      keysRequest.onsuccess = () => { keys = keysRequest.result; void finish(); };
      keysRequest.onerror = () => reject(keysRequest.error);
      valuesRequest.onsuccess = () => { values = valuesRequest.result as Blob[]; void finish(); };
      valuesRequest.onerror = () => reject(valuesRequest.error);
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    return includeProfiles ? { titles, favorites, assets, profiles } : { titles, favorites, assets };
  }, { dbName: DB_NAME, storeName: STORE_NAME, includeProfiles });
}

async function waitForProfileViewCount(page: Page, titleId: number, count: number) {
  await expect.poll(() => page.evaluate(({ titleId }) => {
    const raw = localStorage.getItem("cinebox-profiles");
    if (!raw) return null;
    const store = JSON.parse(raw) as { activeProfileId?: string; data?: Record<string, { viewCounts?: Record<string, number> }> };
    const profileId = store.activeProfileId;
    return profileId ? store.data?.[profileId]?.viewCounts?.[String(titleId)] ?? 0 : null;
  }, { titleId })).toBe(count);
}

test("1 — la progression périodique ne s'enregistre pas à 4 s puis s'enregistre à 5 s", async ({ page }) => {
  const title = film(72001, "Périodique", { videoAssetKey: "72001:video" });
  await seedBrowser(page, [title], [], [{ key: "72001:video", contents: "synthetic-periodic-video" }]);
  const { video } = await openFilmPlayer(page, title.name);
  await setMediaState(page, { duration: 100, currentTime: 0, event: "loadedmetadata" });
  const initialTitles = await readTitles(page);
  expect(initialTitles[0].currentTime ?? 0).toBe(0);
  expect(initialTitles[0].progress).toBe(0);

  await dispatchMediaEvent(page, "timeupdate", 4);
  expect((await readTitles(page))[0].currentTime ?? 0).toBe(0);
  expect((await readTitles(page))[0].progress).toBe(0);

  await dispatchMediaEvent(page, "timeupdate", 5);
  await expect.poll(async () => (await readTitles(page))[0]).toMatchObject({ currentTime: 5, progress: 5 });
  expect(await video.getAttribute("src")).toMatch(/^blob:/);
});

test("2 — l'événement pause force la sauvegarde avant le seuil périodique", async ({ page }) => {
  const title = film(72002, "Pause", { videoAssetKey: "72002:video" });
  await seedBrowser(page, [title], [], [{ key: "72002:video", contents: "synthetic-pause-video" }]);
  await openFilmPlayer(page, title.name);
  await setMediaState(page, { duration: 100, currentTime: 0 });
  await dispatchMediaEvent(page, "timeupdate", 4);
  expect((await readTitles(page))[0].progress).toBe(0);

  await dispatchMediaEvent(page, "pause", 4);

  await expect.poll(async () => (await readTitles(page))[0]).toMatchObject({ currentTime: 4, progress: 4 });
});

test("3 — l'événement seeked force la sauvegarde", async ({ page }) => {
  const title = film(72003, "Seeked", { videoAssetKey: "72003:video" });
  await seedBrowser(page, [title], [], [{ key: "72003:video", contents: "synthetic-seeked-video" }]);
  await openFilmPlayer(page, title.name);
  await setMediaState(page, { duration: 100, currentTime: 0 });
  await dispatchMediaEvent(page, "timeupdate", 2);
  expect((await readTitles(page))[0].progress).toBe(0);

  await dispatchMediaEvent(page, "seeked", 2);

  await expect.poll(async () => (await readTitles(page))[0]).toMatchObject({ currentTime: 2, progress: 2 });
});

test("4 — l'événement ratechange force la sauvegarde", async ({ page }) => {
  const title = film(72004, "Ratechange", { videoAssetKey: "72004:video" });
  await seedBrowser(page, [title], [], [{ key: "72004:video", contents: "synthetic-ratechange-video" }]);
  await openFilmPlayer(page, title.name);
  await setMediaState(page, { duration: 100, currentTime: 0 });
  await dispatchMediaEvent(page, "timeupdate", 2);
  expect((await readTitles(page))[0].progress).toBe(0);

  await dispatchMediaEvent(page, "ratechange", 2);

  await expect.poll(async () => (await readTitles(page))[0]).toMatchObject({ currentTime: 2, progress: 2 });
});

test("5 — recharge puis reprend le titre au point persistant", async ({ page }) => {
  const title = film(72005, "Reprise après rechargement", {
    currentTime: 42,
    progress: 42,
    videoAssetKey: "72005:video",
  });
  const favorites = [72005];
  await seedBrowser(page, [title], favorites, [{ key: "72005:video", contents: "synthetic-reload-video" }]);
  await openFilmPlayer(page, title.name);
  await waitForProfileViewCount(page, title.id, 1);
  await expect.poll(async () => (await readTitles(page))[0]).toMatchObject({
    currentTime: 42,
    progress: 42,
  });
  const beforeResume = await readStorageSnapshot(page, true);

  await setMediaState(page, { duration: 100, currentTime: 0, event: "loadedmetadata" });

  await expect.poll(() => page.locator("video.detail-video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(42);
  expect(await readStorageSnapshot(page, true)).toEqual(beforeResume);
});

test("6 — ferme et rouvre le contexte persistant temporaire en conservant la reprise", async ({}, testInfo) => {
  const profileDir = testInfo.outputPath("synthetic-playback-profile");
  await rm(profileDir, { recursive: true, force: true });
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profileDir, { headless: true });
    await installSyntheticMediaControls(context);
    let page = context.pages()[0] || await context.newPage();
    const title = film(72006, "Fermeture propre", { videoAssetKey: "72006:video" });
    await seedBrowser(page, [title], [72006], [{ key: "72006:video", contents: "synthetic-context-video" }]);
    await openFilmPlayer(page, title.name);
    await waitForProfileViewCount(page, title.id, 1);
    await setMediaState(page, { duration: 100, currentTime: 33, event: "timeupdate" });
    await expect.poll(async () => (await readTitles(page))[0]).toMatchObject({ currentTime: 33, progress: 33 });
    const beforeClose = await readStorageSnapshot(page, true);
    await context.close();
    context = undefined;

    context = await chromium.launchPersistentContext(profileDir, { headless: true });
    await installSyntheticMediaControls(context);
    page = context.pages()[0] || await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Ouvrir Fermeture propre" })).toBeVisible();
    expect(await readStorageSnapshot(page, true)).toEqual(beforeClose);
    await openFilmPlayer(page, "Fermeture propre");
    // Reopening the browser within the 30 s view-dedupe window counts as the same view.
    await waitForProfileViewCount(page, title.id, 1);
    await expect.poll(async () => (await readTitles(page))[0]).toMatchObject({
      viewCount: 1,
      backdrop: "",
      seasons: [],
      currentTime: 33,
      progress: 33,
    });
    const beforeResume = await readStorageSnapshot(page, true);
    await setMediaState(page, { duration: 100, currentTime: 0, event: "loadedmetadata" });
    await expect.poll(() => page.locator("video.detail-video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBe(33);
    expect(await readStorageSnapshot(page, true)).toEqual(beforeResume);
  } finally {
    await context?.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("7 — reprend l'épisode précis sélectionné dans la série", async ({ page }) => {
  const title = series(72007, {
    seasons: [{ number: 1, episodes: [
      { number: 1, title: "Épisode un", videoAssetKey: "72007:episode:1:1", currentTime: 15, progress: 15 },
      { number: 2, title: "Épisode deux", videoAssetKey: "72007:episode:1:2", currentTime: 44, progress: 44 },
    ] }],
  });
  const assets = [
    { key: "72007:episode:1:1", contents: "synthetic-episode-one" },
    { key: "72007:episode:1:2", contents: "synthetic-episode-two" },
  ];
  await seedBrowser(page, [title], [], assets);
  const before = await readStorageSnapshot(page);
  const { video } = await openEpisodePlayer(page, title.name, "Épisode deux");
  await setMediaState(page, { duration: 100, currentTime: 0, event: "loadedmetadata" });

  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(44);
  expect(await readStorageSnapshot(page)).toEqual(before);
});

test("8 — le remplacement remet à zéro uniquement la progression de l'épisode ciblé", async ({ page }) => {
  const title = series(72008, {
    seasons: [{ number: 1, episodes: [
      { number: 1, title: "À remplacer", videoAssetKey: "72008:episode:1:1", currentTime: 31, progress: 31 },
      { number: 2, title: "À conserver", videoAssetKey: "72008:episode:1:2", currentTime: 62, progress: 62 },
    ] }],
  });
  await seedBrowser(page, [title], [], [
    { key: "72008:episode:1:1", contents: "synthetic-old-episode-one" },
    { key: "72008:episode:1:2", contents: "synthetic-kept-episode-two" },
  ]);
  await page.locator(".sidebar .nav-item").filter({ hasText: "Administration" }).click();
  await page.locator(".admin-section-nav").getByRole("button", { name: "Séries" }).click();
  await page.getByRole("button", { name: `Ouvrir ${title.name}` }).click();
  const details = page.getByRole("dialog");
  await details.getByRole("button", { name: "Saisons & épisodes" }).click();
  await details.getByRole("button", { name: /Modifier À remplacer/ }).click();
  const editor = page.getByRole("dialog").filter({ has: page.locator("#episode-video-input") });
  await editor.locator("#episode-video-input").setInputFiles({
    name: "replacement.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("synthetic-replacement-video-content"),
  });
  await editor.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Les informations de l’épisode ont été enregistrées.")).toBeVisible();
  const saved = (await readTitles(page))[0];
  const episodes = (saved.seasons as Array<{ episodes: Array<Record<string, unknown>> }>)[0].episodes;
  expect(episodes[0]).toMatchObject({ currentTime: 0, progress: 0 });
  expect(episodes[0].videoAssetKey).toMatch(/^72008:episode:1:1:v:/);
  expect(episodes[1]).toMatchObject({ videoAssetKey: "72008:episode:1:2", currentTime: 62, progress: 62 });
  const snapshot = await readStorageSnapshot(page);
  expect(snapshot.assets).toContainEqual([episodes[0].videoAssetKey as string, "synthetic-replacement-video-content"]);
  expect(snapshot.assets).toContainEqual(["72008:episode:1:2", "synthetic-kept-episode-two"]);
  expect(snapshot.assets).not.toContainEqual(["72008:episode:1:1", "synthetic-old-episode-one"]);
});

test("9 — sauvegarder un épisode ne modifie pas la progression de son voisin", async ({ page }) => {
  const title = series(72009, {
    seasons: [{ number: 1, episodes: [
      { number: 1, title: "Épisode actif", videoAssetKey: "72009:episode:1:1", currentTime: 12, progress: 12 },
      { number: 2, title: "Épisode voisin", videoAssetKey: "72009:episode:1:2", currentTime: 51, progress: 51 },
    ] }],
  });
  await seedBrowser(page, [title], [], [
    { key: "72009:episode:1:1", contents: "synthetic-active-episode" },
    { key: "72009:episode:1:2", contents: "synthetic-neighbor-episode" },
  ]);
  const before = await readTitles(page);
  await openEpisodePlayer(page, title.name, "Épisode actif");
  await setMediaState(page, { duration: 100, currentTime: 0 });
  await dispatchMediaEvent(page, "timeupdate", 20);

  await expect.poll(async () => (await readTitles(page))[0].seasons).not.toEqual(before[0].seasons);
  const episodes = ((await readTitles(page))[0].seasons as Array<{ episodes: Array<Record<string, unknown>> }>)[0].episodes;
  expect(episodes[0]).toMatchObject({ currentTime: 20, progress: 20 });
  expect(episodes[1]).toMatchObject({ videoAssetKey: "72009:episode:1:2", currentTime: 51, progress: 51 });
});

test("10 — une erreur localStorage ne remplace pas les données persistées", async ({ page }) => {
  const title = film(72010, "Échec de sauvegarde", { videoAssetKey: "72010:video" });
  await seedBrowser(page, [title], [72010], [{ key: "72010:video", contents: "synthetic-storage-error-video" }]);
  const before = await readStorageSnapshot(page, true);
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "cinebox-profiles") throw new DOMException("Synthetic localStorage failure", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    };
  });
  await page.reload();
  await openFilmPlayer(page, title.name);
  await setMediaState(page, { duration: 100, currentTime: 0 });
  await dispatchMediaEvent(page, "timeupdate", 10);

  await expect(page.getByText(/Le stockage local est plein/)).toBeVisible();
  expect(await readStorageSnapshot(page, true)).toEqual(before);
});

for (const [seconds, shouldResume] of [[3, false], [4, true], [97, false], [98, false]] as const) {
  test(`reprise aux limites — ${seconds} s, reprise attendue : ${shouldResume}`, async ({ page }) => {
    const title = film(72100 + seconds, `Limite ${seconds}`, {
      currentTime: seconds,
      progress: seconds,
      videoAssetKey: `72100${seconds}:video`,
    });
    await seedBrowser(page, [title], [], [{ key: `72100${seconds}:video`, contents: `synthetic-boundary-${seconds}` }]);
    await openFilmPlayer(page, title.name);
    await setMediaState(page, { duration: 100, currentTime: 0, event: "loadedmetadata" });

    await expect.poll(() => page.locator("video.detail-video").evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBe(shouldResume ? seconds : 0);
    expect((await readTitles(page))[0]).toMatchObject({ currentTime: seconds, progress: seconds });
  });
}

test("la vidéo active correspond au contenu synthétique de l'épisode sélectionné", async ({ page }) => {
  const title = series(72015);
  await seedBrowser(page, [title], [], [
    { key: "72015:episode:1:1", contents: "episode-one-identity" },
    { key: "72015:episode:1:2", contents: "episode-two-identity" },
  ]);
  const { video } = await openEpisodePlayer(page, title.name, "Épisode 2");

  const sourceContent = await video.evaluate(async (element: HTMLVideoElement) => {
    const response = await fetch(element.currentSrc);
    return response.text();
  });

  expect(sourceContent).toBe("episode-two-identity");
  expect(await readStorageSnapshot(page)).toMatchObject({ favorites: "[]" });
});
