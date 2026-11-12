import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";

const ASSET_DB = "cinebox-assets";
const ASSET_STORE = "files";
const filmId = 73101;
const seriesId = 73102;

type Episode = {
  number: number;
  title: string;
  videoAssetKey: string;
  currentTime: number;
  progress: number;
};

type StoredTitle = {
  id: number;
  name: string;
  kind: "Film" | "Série";
  year: number;
  genre: string;
  description: string;
  poster: string;
  progress: number;
  duration: string;
  currentTime?: number;
  videoAssetKey?: string;
  seasons?: Array<{ number: number; episodes: Episode[] }>;
};

type MediaEvent = {
  type: string;
  currentTime: number;
  duration: number;
  readyState: number;
  videoWidth: number;
  videoHeight: number;
};

declare global {
  interface Window {
    __cineboxMediaEvents: MediaEvent[];
  }
}

const mediaEventCapture = () => {
  window.__cineboxMediaEvents = [];
  for (const type of ["loadedmetadata", "playing", "seeked"]) {
    document.addEventListener(type, (event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement)) return;
      window.__cineboxMediaEvents.push({
        type,
        currentTime: video.currentTime,
        duration: video.duration,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      });
    }, true);
  }
};

function title(id: number, name: string, fields: Partial<StoredTitle> = {}): StoredTitle {
  return {
    id,
    name,
    kind: "Film",
    year: 2026,
    genre: "Fixture synthétique",
    description: `Lecture réelle synthétique ${id}.`,
    poster: "",
    progress: 0,
    duration: "14 secondes",
    ...fields,
  };
}

async function seedIsolatedLibrary(page: Page, titles: StoredTitle[], assets: Array<{ key: string; base64: string }>) {
  await page.addInitScript(mediaEventCapture);
  await page.goto("/");
  await page.evaluate(async ({ titles, assets, dbName, storeName }) => {
    localStorage.setItem("cinebox-titles", JSON.stringify(titles));
    localStorage.setItem("cinebox-favorites", "[]");
    // The first navigation creates an empty profile. Remove only that isolated
    // test value so reload migrates this synthetic historical library.
    localStorage.removeItem("cinebox-profiles");
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
      for (const asset of assets) {
        const bytes = Uint8Array.from(atob(asset.base64), (character) => character.charCodeAt(0));
        store.put(new Blob([bytes], { type: "video/webm" }), asset.key);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, { titles, assets, dbName: ASSET_DB, storeName: ASSET_STORE });
  await page.reload();
}

async function openFilm(page: Page, name: string) {
  await page.getByRole("button", { name: `Ouvrir ${name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^(Lecture|Reprendre)$/ }).click();
  const video = page.locator("video.detail-video");
  await expect(video).toBeVisible();
  return video;
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
    return titles.map((storedTitle) => {
      const playback = profile.playback?.[String(storedTitle.id)];
      const titleAssetKey = storedTitle.videoAssetKey || `${storedTitle.id}:video`;
      const validPlayback = playback && (!playback.assetKey || playback.assetKey === titleAssetKey) ? playback : undefined;
      const seasons = storedTitle.seasons?.map((season) => ({
        ...season,
        episodes: season.episodes.map((episode) => {
          const saved = playback?.episodes?.[`${season.number}:${episode.number}`];
          const assetKey = episode.videoAssetKey || `${storedTitle.id}:episode:${season.number}:${episode.number}`;
          return saved && (!saved.assetKey || saved.assetKey === assetKey)
            ? { ...episode, currentTime: saved.currentTime, progress: saved.progress }
            : { ...episode, currentTime: 0, progress: 0 };
        }),
      }));
      return {
        ...storedTitle,
        currentTime: validPlayback?.currentTime ?? 0,
        progress: validPlayback?.progress ?? 0,
        ...(seasons ? { seasons } : {}),
      };
    });
  });
}

async function waitForEvent(page: Page, type: MediaEvent["type"]) {
  await expect.poll(() => page.evaluate((eventType) =>
    window.__cineboxMediaEvents.some((event) => event.type === eventType), type), { timeout: 12_000 }).toBe(true);
  return page.evaluate((eventType) =>
    window.__cineboxMediaEvents.find((event) => event.type === eventType)!, type);
}

async function fixtureBase64(name: string) {
  return (await readFile(path.join(process.cwd(), "tests", "fixtures", name))).toString("base64");
}

test("Chromium décode la vidéo, sauvegarde sa progression et reprend après rechargement", async ({ page }) => {
  const fixture = await readFile(path.join(process.cwd(), "tests", "fixtures", "cinebox-short-vp8.webm"));
  const durationSeconds = 14;
  const film = title(filmId, "Lecture réelle", {
    videoAssetKey: `${filmId}:video`,
    currentTime: 0,
    progress: 0,
  });
  await seedIsolatedLibrary(page, [film], [{ key: film.videoAssetKey!, base64: fixture.toString("base64") }]);

  let video = await openFilm(page, film.name);
  const metadata = await waitForEvent(page, "loadedmetadata");
  expect(metadata.duration).toBeCloseTo(durationSeconds, 2);
  expect(metadata.readyState).toBeGreaterThanOrEqual(1);
  expect(metadata.videoWidth).toBe(320);
  expect(metadata.videoHeight).toBe(180);

  const playing = await waitForEvent(page, "playing");
  expect(playing.readyState).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 25_000 }).toBeGreaterThan(5);
  await expect.poll(async () => (await readTitles(page)).find((entry) => entry.id === filmId)?.currentTime ?? 0, {
    timeout: 8_000,
  }).toBeGreaterThanOrEqual(5);

  const saved = (await readTitles(page)).find((entry) => entry.id === filmId)!;
  expect(saved.progress).toBeGreaterThan(0);
  expect(saved.progress).toBeLessThan(100);
  expect(await page.evaluate(() => localStorage.getItem("cinebox-favorites"))).toBe("[]");
  const savedSecond = saved.currentTime!;
  expect(savedSecond).toBeGreaterThanOrEqual(5);

  await page.reload();
  video = await openFilm(page, film.name);
  const resumedMetadata = await waitForEvent(page, "loadedmetadata");
  expect(resumedMetadata.duration).toBeCloseTo(metadata.duration, 1);
  await expect.poll(() => page.evaluate((second) =>
    window.__cineboxMediaEvents.some((event) => event.type === "seeked" && event.currentTime >= second - 1 && event.currentTime <= second + 1), savedSecond), {
    timeout: 8_000,
  }).toBe(true);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 8_000 })
    .toBeGreaterThanOrEqual(savedSecond - 1);

});

test("la reprise d'un épisode charge son Blob exact et ne change pas la progression voisine", async ({ page }) => {
  const episodeOne = await readFile(path.join(process.cwd(), "tests", "fixtures", "cinebox-short-vp8.webm"));
  const episodeTwo = await readFile(path.join(process.cwd(), "tests", "fixtures", "cinebox-episode-distinct-vp8.webm"));
  const keyOne = `${seriesId}:episode:1:1`;
  const keyTwo = `${seriesId}:episode:1:2`;
  const series = title(seriesId, "Série réelle synthétique", {
    kind: "Série",
    duration: "1 saison",
    seasons: [{ number: 1, episodes: [
      { number: 1, title: "Épisode adjacent", videoAssetKey: keyOne, currentTime: 1, progress: 7 },
      { number: 2, title: "Épisode à reprendre", videoAssetKey: keyTwo, currentTime: 4, progress: 29 },
    ] }],
  });
  const episodeOneHash = createHash("sha256").update(episodeOne).digest("hex");
  const episodeTwoHash = createHash("sha256").update(episodeTwo).digest("hex");
  expect(episodeOneHash).not.toBe(episodeTwoHash);

  await seedIsolatedLibrary(page, [series], [
    { key: keyOne, base64: episodeOne.toString("base64") },
    { key: keyTwo, base64: episodeTwo.toString("base64") },
  ]);
  await page.getByRole("button", { name: `Ouvrir ${series.name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Saisons & épisodes" }).click();
  await dialog.locator(".detail-episode-main").filter({ hasText: "Épisode à reprendre" }).click();
  const video = page.locator("video.detail-video");
  await expect(video).toBeVisible();

  const actualHash = await video.evaluate(async (element) => {
    const response = await fetch((element as HTMLVideoElement).currentSrc);
    const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
  expect(actualHash).toBe(episodeTwoHash);

  const metadata = await waitForEvent(page, "loadedmetadata");
  expect(metadata.duration).toBeCloseTo(14, 2);
  expect(metadata.videoWidth).toBe(320);
  expect(metadata.videoHeight).toBe(180);
  await waitForEvent(page, "playing");
  await expect.poll(() => page.evaluate(() =>
    window.__cineboxMediaEvents.some((event) => event.type === "seeked" && event.currentTime >= 3.5 && event.currentTime <= 5)), {
    timeout: 8_000,
  }).toBe(true);
  await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 15_000 }).toBeGreaterThan(5);
  await expect.poll(async () => {
    const current = (await readTitles(page)).find((entry) => entry.id === seriesId)!;
    return current.seasons![0].episodes[1].currentTime;
  }, { timeout: 12_000 }).toBeGreaterThan(5);

  const persisted = (await readTitles(page)).find((entry) => entry.id === seriesId)!.seasons![0].episodes;
  expect(persisted[0]).toMatchObject({ currentTime: 1, progress: 7 });
  expect(persisted[1].currentTime).toBeGreaterThan(5);
  expect(persisted[1].progress).toBeGreaterThan(29);
  expect(await page.evaluate(() => localStorage.getItem("cinebox-favorites"))).toBe("[]");
});
