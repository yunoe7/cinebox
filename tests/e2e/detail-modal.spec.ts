import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "./fixtures";

const ASSET_DB = "cinebox-assets";
const ASSET_STORE = "files";

type FixtureTitle = {
  id: number;
  name: string;
  kind: "Film" | "Série" | "Vidéo";
  year: number;
  genre: string;
  description: string;
  poster: string;
  backdrop: string;
  progress: number;
  duration: string;
  [key: string]: unknown;
};

type FixtureAsset = { key: string; base64: string };

declare global {
  interface Window {
    __cineboxDetailMediaEvents: Array<{ type: string; currentTime: number; duration: number }>;
  }
}

function captureMediaEvents() {
  window.__cineboxDetailMediaEvents = [];
  for (const type of ["loadedmetadata", "seeked"]) {
    document.addEventListener(type, (event) => {
      if (!(event.target instanceof HTMLVideoElement)) return;
      window.__cineboxDetailMediaEvents.push({ type, currentTime: event.target.currentTime, duration: event.target.duration });
    }, true);
  }
}

async function fixture(name: string) {
  return (await readFile(path.join(process.cwd(), "tests", "fixtures", name))).toString("base64");
}

async function seed(page: Page, titles: FixtureTitle[], assets: FixtureAsset[] = []) {
  await page.addInitScript(captureMediaEvents);
  await page.goto("/");
  await page.evaluate(async ({ titles, assets, dbName, storeName }) => {
    // The browser context is fresh and isolated by Playwright. Replace only its synthetic library.
    localStorage.removeItem("cinebox-profiles");
    localStorage.setItem("cinebox-titles", JSON.stringify(titles));
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
      for (const asset of assets) {
        const bytes = Uint8Array.from(atob(asset.base64), character => character.charCodeAt(0));
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

async function openDetails(page: Page, name: string) {
  await page.getByRole("button", { name: `Ouvrir ${name}` }).click();
  return page.getByRole("dialog");
}

async function expectResumedAt(video: Locator, second: number) {
  await expect.poll(() => video.evaluate(element => {
    const media = element as HTMLVideoElement;
    return media.currentTime;
  }), { timeout: 10_000 }).toBeGreaterThanOrEqual(second - 0.5);
  await expect.poll(() => video.evaluate((_element, target: number) => window.__cineboxDetailMediaEvents.some(event =>
    event.type === "seeked" && Math.abs(event.currentTime - target) <= 0.5), second), { timeout: 10_000 }).toBe(true);
}

test("la fiche film affiche uniquement les métadonnées disponibles et conserve l'action favoris", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const ratedFilm: FixtureTitle = {
    id: 74201,
    name: "Le Signal d’argent",
    kind: "Film",
    year: 2025,
    genre: "Drame, Science-fiction",
    genres: ["Drame", "Science-fiction"],
    description: "Une enquête synthétique au cœur d’une station isolée.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "1 h 42",
    rating: 8.479,
    voteCount: 1234,
    director: "Camille Exemple",
    cast: ["A. Exemple", "B. Exemple"],
  };
  const sparseFilm: FixtureTitle = {
    id: 74202,
    name: "Archive sans métadonnées",
    kind: "Film",
    year: 2024,
    genre: "",
    description: "",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "",
  };
  await seed(page, [ratedFilm, sparseFilm]);

  const filmDetails = await openDetails(page, ratedFilm.name);
  await expect(filmDetails.locator("#detail-modal-title")).toHaveText(ratedFilm.name);
  await expect(filmDetails.getByLabel("Note TMDB 8.5 sur 10")).toBeVisible();
  await expect(filmDetails.locator(".detail-page-description")).toContainText(ratedFilm.description);
  await expect(filmDetails.locator(".detail-overview-copy")).toContainText("Camille Exemple");
  await expect(filmDetails.locator(".detail-overview-copy")).toContainText("A. Exemple, B. Exemple");
  await expect(filmDetails.locator(".magic-blur-fade")).toBeVisible();
  await expect.poll(() => filmDetails.locator(".magic-blur-fade").evaluate(element => getComputedStyle(element).filter)).not.toContain("blur(");

  const favoriteAction = filmDetails.locator(".detail-page-actions .detail-icon-btn");
  await favoriteAction.click();
  await expect(favoriteAction).toHaveAttribute("aria-pressed", "true");
  await filmDetails.getByRole("button", { name: "Fermer les détails" }).click();

  const sparseDetails = await openDetails(page, sparseFilm.name);
  await expect(sparseDetails.locator(".detail-rating")).toHaveCount(0);
  await expect(sparseDetails.locator(".detail-page-description")).toHaveCount(0);
  await expect(sparseDetails.locator(".detail-page-meta")).not.toContainText(/undefined|NaN|TMDB/);
  await expect(sparseDetails.locator(".detail-overview-copy")).not.toContainText(/undefined|NaN/);
  await sparseDetails.getByRole("button", { name: "Fermer les détails" }).click();
});

test("la fiche série filtre les saisons et reprend l'épisode associé à son Blob et sa progression", async ({ page }) => {
  const firstMedia = await fixture("cinebox-short-vp8.webm");
  const resumedMedia = await fixture("cinebox-episode-distinct-vp8.webm");
  const firstKey = "74203:episode:1:1";
  const resumedKey = "74203:episode:2:1";
  const series: FixtureTitle = {
    id: 74203,
    name: "Les Archives du Nord",
    kind: "Série",
    year: 2024,
    genre: "Mystère",
    description: "Une série synthétique de validation.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "2 saisons",
    seasons: [
      { number: 1, episodes: [{ number: 1, title: "La première trace", videoAssetKey: firstKey, currentTime: 1, progress: 7, runtime: 14, overview: "Une piste apparaît." }] },
      { number: 2, name: "Le retour", overview: "Les indices changent de sens.", episodes: [{ number: 1, title: "La piste retrouvée", videoAssetKey: resumedKey, currentTime: 4, progress: 29, runtime: 14, overview: "L’enquête reprend." }] },
    ],
  };
  const expectedResumedHash = createHash("sha256").update(Buffer.from(resumedMedia, "base64")).digest("hex");
  await seed(page, [series], [{ key: firstKey, base64: firstMedia }, { key: resumedKey, base64: resumedMedia }]);

  let details = await openDetails(page, series.name);
  await expect(details.getByRole("button", { name: "Reprendre" })).toBeVisible();
  await details.getByRole("button", { name: "Saisons & épisodes" }).click();
  const seasonSelector = details.getByRole("combobox", { name: "Choisir une saison" });
  await expect(seasonSelector).toHaveValue("1");
  await expect(details.getByText("La première trace")).toBeVisible();
  await details.getByRole("button", { name: "Fermer les détails" }).click();

  details = await openDetails(page, series.name);
  await details.getByRole("button", { name: "Saisons & épisodes" }).click();
  await details.getByRole("combobox", { name: "Choisir une saison" }).selectOption("2");
  await expect(details.getByRole("heading", { name: "Le retour" })).toBeVisible();
  await expect(details.getByText("La piste retrouvée")).toBeVisible();
  await expect(details.getByText("L’enquête reprend.")).toBeVisible();
  await expect(details.getByText("14 min · 29 % regardé")).toBeVisible();
  await expect(details.getByRole("button", { name: "Reprendre" })).toBeVisible();

  await details.getByRole("button", { name: "Reprendre" }).click();
  const video = page.locator("video.detail-video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(async element => {
    const response = await fetch((element as HTMLVideoElement).currentSrc);
    const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }), { timeout: 10_000 }).toBe(expectedResumedHash);
  await expectResumedAt(video, 4);
  await expect(video).toHaveAttribute("aria-label", "Lecteur vidéo");
});

test("les affiches et les informations restent en colonnes distinctes sur desktop et empilées sur mobile", async ({ page }) => {
  const poster = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#351016"/><path d="M0 450 300 0" stroke="#b33" stroke-width="28"/></svg>').toString("base64");
  const longTitle = "Les Chroniques extraordinaires de la constellation oubliée et du dernier voyageur";
  const cast = ["Alexandre Exemple", "Béatrice Exemple", "Camille Exemple", "Dorian Exemple", "Élodie Exemple", "Farid Exemple", "Gabrielle Exemple", "Hugo Exemple", "Inès Exemple", "Julien Exemple", "Karim Exemple", "Lina Exemple"];
  const film: FixtureTitle = {
    id: 74204,
    name: longTitle,
    kind: "Film",
    year: 2026,
    genre: "Aventure, Drame",
    genres: ["Aventure", "Drame"],
    description: "Un synopsis synthétique volontairement très long. ".repeat(24),
    poster,
    backdrop: "",
    progress: 0,
    duration: "2 h 04",
    director: "Camille Exemple",
    cast,
  };
  const series: FixtureTitle = {
    id: 74205,
    name: "Les archives sans fin",
    kind: "Série",
    year: 2026,
    genre: "Mystère",
    description: "Une série synthétique de mise en page.",
    poster,
    backdrop: "",
    progress: 0,
    duration: "1 saison",
    cast,
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Le premier dossier", overview: "Épisode synthétique.", currentTime: 0, progress: 0 }] }],
  };
  await seed(page, [film, series]);

  const assertDesktopColumns = async (name: string) => {
    const details = await openDetails(page, name);
    await details.getByRole("button", { name: "Synopsis & détails" }).click();
    const geometry = await details.evaluate(dialog => {
      const posterElement = dialog.querySelector<HTMLElement>(".detail-overview-poster");
      const copyElement = dialog.querySelector<HTMLElement>(".detail-overview-copy");
      if (!posterElement || !copyElement) throw new Error("Affiche ou panneau d'informations absent");
      const posterRect = posterElement.getBoundingClientRect();
      const copyRect = copyElement.getBoundingClientRect();
      return { posterRight: posterRect.right, copyLeft: copyRect.left, posterWidth: posterRect.width, copyWidth: copyRect.width, overflow: copyElement.scrollWidth > copyElement.clientWidth };
    });
    expect(geometry.posterWidth).toBeGreaterThan(100);
    expect(geometry.copyLeft).toBeGreaterThanOrEqual(geometry.posterRight + 20);
    expect(geometry.overflow).toBe(false);
    await expect(details.locator(".detail-overview-copy")).toContainText(name);
    await expect(details.locator(".detail-overview-cast")).toContainText(cast[cast.length - 1]);
    await details.getByRole("button", { name: "Fermer les détails" }).click();
  };

  await page.setViewportSize({ width: 1440, height: 1000 });
  await assertDesktopColumns(film.name);
  await assertDesktopColumns(series.name);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileDetails = await openDetails(page, film.name);
  const mobileGeometry = await mobileDetails.evaluate(dialog => {
    const overview = dialog.querySelector<HTMLElement>(".detail-overview");
    const posterElement = dialog.querySelector<HTMLElement>(".detail-overview-poster");
    const copyElement = dialog.querySelector<HTMLElement>(".detail-overview-copy");
    if (!overview || !posterElement || !copyElement) throw new Error("Structure de fiche mobile incomplète");
    const overviewRect = overview.getBoundingClientRect();
    const posterRect = posterElement.getBoundingClientRect();
    const copyRect = copyElement.getBoundingClientRect();
    return { overviewLeft: overviewRect.left, overviewRight: overviewRect.right, posterBottom: posterRect.bottom, copyTop: copyRect.top, copyLeft: copyRect.left, copyRight: copyRect.right, documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(mobileGeometry.copyTop).toBeGreaterThanOrEqual(mobileGeometry.posterBottom + 12);
  expect(mobileGeometry.copyLeft).toBeGreaterThanOrEqual(mobileGeometry.overviewLeft);
  expect(mobileGeometry.copyRight).toBeLessThanOrEqual(mobileGeometry.overviewRight + 1);
  expect(mobileGeometry.documentOverflow).toBe(false);
  await expect(mobileDetails.locator(".detail-overview-copy")).toContainText(cast[cast.length - 1]);
});

test("la fiche détail piège le focus, verrouille le défilement et restaure le focus à la fermeture", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const film: FixtureTitle = {
    id: 74301,
    name: "Dialogue accessible",
    kind: "Film",
    year: 2025,
    genre: "Drame",
    description: "Un film synthétique pour valider le dialogue.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "1 h 30",
  };
  await seed(page, [film]);

  const opener = page.getByRole("button", { name: `Ouvrir ${film.name}` });
  await opener.focus();
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Fermer les détails" })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  for (let index = 0; index < 10; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  }
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("une fiche TMDB sans vidéo locale est lue via Vidsrc sans requête Bunny", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const film: FixtureTitle = {
    id: 74206,
    name: "Lecture distante",
    kind: "Film",
    year: 2024,
    genre: "Drame",
    description: "Un film TMDB sans fichier local.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "1 h 48",
    tmdbId: 550,
  };
  const series: FixtureTitle = {
    id: 74207,
    name: "Série distante",
    kind: "Série",
    year: 2024,
    genre: "Drame",
    description: "Une série TMDB sans fichier local.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "1 saison",
    tmdbId: 1399,
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Le pilote", overview: "Premier épisode.", currentTime: 0, progress: 0 }] }],
  };
  await seed(page, [film, series]);

  const filmDetails = await openDetails(page, film.name);
  await filmDetails.getByRole("button", { name: "Lecture" }).click();
  await expect(page.locator("iframe[title]")).toHaveAttribute("src", /^https:\/\/vidsrc\.sh\/embed\/movie\/550/);
  await page.getByRole("button", { name: "Fermer les détails" }).click();

  const seriesDetails = await openDetails(page, series.name);
  await seriesDetails.getByRole("button", { name: "Lire le premier épisode" }).click();
  await expect(page.locator("iframe[title]")).toHaveAttribute("src", /^https:\/\/vidsrc\.sh\/embed\/tv\/1399\/1\/1/);

  expect(requests.some((url) => /mediadelivery\.net|b-cdn\.net|bunnycdn\.com/i.test(url))).toBe(false);
  await expect(page.getByText(/Bunny/i)).toHaveCount(0);
});

test("la confirmation de suppression ne se ferme pas au clic sur le fond et garde le focus dans le dialogue", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const film: FixtureTitle = {
    id: 74302,
    name: "Suppression protégée",
    kind: "Film",
    year: 2025,
    genre: "Drame",
    description: "Un film synthétique pour valider la confirmation.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "1 h 30",
  };
  await seed(page, [film]);

  await page.locator(".sidebar .nav-item").filter({ hasText: "Administration" }).click();
  const legacyRow = page.locator(".admin-legacy-row").filter({ hasText: film.name });
  const deleteTrigger = legacyRow.getByRole("button", { name: "Supprimer" });
  await deleteTrigger.click();

  const alert = page.getByRole("alertdialog");
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "Annuler" })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.locator(".modal-backdrop.app-confirm-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(alert).toBeVisible();
  await expect(legacyRow).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(alert).toHaveCount(0);
  // Focus must return to the stable legacy-row trigger, not to body.
  await expect(deleteTrigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  await deleteTrigger.click();
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Annuler" }).click();
  await expect(alert).toHaveCount(0);
  await expect(deleteTrigger).toBeFocused();
});
