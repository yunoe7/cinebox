import { expect, test, type Page } from "./fixtures";

const SHARED_MOVIE = {
  id: "tmdb:movie:501",
  kind: "movie",
  title: "Le Film Partagé",
  overview: "Un film publié dans le catalogue partagé.",
  releaseDate: "2021-03-12",
  posterPath: null,
  backdropPath: null,
  genres: ["Drame"],
  metadata: { tmdbId: 501, ageRating: "TP", minAge: 0 },
  seasons: [],
};

const SHARED_BLACK_CLOVER = {
  id: "tmdb:series:73223",
  kind: "series",
  title: "Black Clover",
  overview: "Une série publiée dans le catalogue partagé.",
  releaseDate: "2017-10-03",
  posterPath: null,
  backdropPath: null,
  genres: ["Animation"],
  metadata: { tmdbId: 73223 },
  seasons: [{ number: 1, episodes: [{ number: 1, title: "Les garçons de la campagne" }] }],
};

const SHARED_VIDEO = {
  id: "tmdb:video:601",
  kind: "video",
  title: "La Vidéo Partagée",
  overview: "Une vidéo publiée dans le catalogue partagé.",
  releaseDate: "2022-07-01",
  posterPath: null,
  backdropPath: null,
  genres: ["Voyage"],
  metadata: { tmdbId: 601, minAge: 0 },
  seasons: [],
};

const SHARED_ADULT_MOVIE = {
  id: "tmdb:movie:502",
  kind: "movie",
  title: "Le Film Adulte Partagé",
  overview: "Un film classé 18+.",
  releaseDate: "2019-01-01",
  posterPath: null,
  backdropPath: null,
  genres: ["Thriller"],
  metadata: { tmdbId: 502, ageRating: "18" },
  seasons: [],
};

const localTitles = [
  {
    id: 91001,
    name: "Le Voyage Bleu",
    kind: "Film",
    year: 2024,
    genre: "Aventure",
    description: "Un récit de test.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "1 h 40",
  },
  {
    id: 91002,
    name: "Signal Rouge",
    kind: "Série",
    year: 2023,
    genre: "Thriller",
    description: "Une série de test.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "1 saison",
    episodes: "1 épisode",
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Premier signal" }] }],
  },
  {
    id: 91003,
    name: "Les routes du silence",
    kind: "Vidéo",
    year: 2022,
    genre: "Voyage",
    description: "Une vidéo de test.",
    poster: "",
    backdrop: "",
    progress: 0,
    duration: "18 min",
  },
];

type LocalFixture = {
  id: number;
  name: string;
  kind: string;
  year: number;
  genre: string;
  description: string;
  poster: string;
  backdrop: string;
  progress: number;
  duration: string;
  [key: string]: unknown;
};

async function seedLocalLibrary(page: Page, titles: LocalFixture[] = localTitles) {
  await page.addInitScript((value) => {
    if (window.localStorage.getItem("cinebox-titles") === null) {
      window.localStorage.setItem("cinebox-titles", JSON.stringify(value));
      window.localStorage.setItem("cinebox-favorites", "[]");
    }
  }, titles);
}

/** Simulates the public D1 endpoint. It deliberately ignores `maxAge` so the
 * browser-side fail-closed filter is exercised too. */
async function mockSharedCatalog(page: Page, rows: unknown[], requests: string[] = []) {
  await page.route(/\/api\/catalog\?/, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        titles: rows,
        stats: { titles: rows.length, films: 0, series: 0, videos: 0, episodes: 0 },
        pagination: { limit: 50, offset: 0, count: rows.length },
      }),
    });
  });
}

test("le catalogue D1 est séparé par type et les compteurs restent exacts", async ({ page }) => {
  await seedLocalLibrary(page);
  await mockSharedCatalog(page, [SHARED_MOVIE, SHARED_BLACK_CLOVER, SHARED_VIDEO, SHARED_ADULT_MOVIE]);
  await page.goto("/");

  await page.locator(".sidebar .nav-item").filter({ hasText: "Séries" }).click();
  await expect(page.getByText("2 séries dans votre collection")).toBeVisible();
  await expect(page.locator(".films-result-count")).toContainText("2 résultats");
  await expect(page.getByRole("button", { name: "Ouvrir Black Clover" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Signal Rouge" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Le Voyage Bleu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir Les routes du silence" })).toHaveCount(0);

  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();
  await expect(page.getByText("3 films dans votre collection")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Le Voyage Bleu" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Partagé" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Black Clover" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Adulte Partagé" })).toBeVisible();

  await page.locator(".sidebar .nav-item").filter({ hasText: "Vidéos" }).click();
  await expect(page.getByText("2 vidéos dans votre collection")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Les routes du silence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir La Vidéo Partagée" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Black Clover" })).toHaveCount(0);
});

test("la recherche Black Clover reste dans Séries et ne fuit jamais dans Films", async ({ page }) => {
  await seedLocalLibrary(page);
  await mockSharedCatalog(page, [SHARED_MOVIE, SHARED_BLACK_CLOVER, SHARED_VIDEO]);
  await page.goto("/");

  await page.locator(".sidebar .nav-item").filter({ hasText: "Séries" }).click();
  const search = page.getByRole("textbox", { name: "Rechercher une série" });
  await search.fill("  BLACK   clover  ");
  await expect(page.locator(".films-result-count")).toContainText("1 résultat");
  await expect(page.getByRole("button", { name: "Ouvrir Black Clover" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Signal Rouge" })).toHaveCount(0);

  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();
  await expect(page.getByRole("textbox", { name: "Rechercher dans ma collection" })).toHaveValue("  BLACK   clover  ");
  await expect(page.locator(".films-result-count")).toContainText("0 résultat");
  await expect(page.getByRole("button", { name: "Ouvrir Black Clover" })).toHaveCount(0);
  await expect(page.getByText("Aucun film ne correspond à votre recherche")).toBeVisible();
  await page.getByRole("button", { name: "Effacer la recherche et les filtres" }).click();
  await expect(page.locator(".films-result-count")).toContainText("2 résultats");
});

test("un favori D1 est immédiat et persistant dans le compte Discord", async ({ page }) => {
  await seedLocalLibrary(page);
  await mockSharedCatalog(page, [SHARED_MOVIE, SHARED_BLACK_CLOVER, SHARED_VIDEO]);
  await page.goto("/");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Séries" }).click();
  await page.getByRole("button", { name: "Ajouter Black Clover aux favoris" }).click();
  await expect(page.getByRole("button", { name: "Retirer Black Clover des favoris" })).toBeVisible();
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).locator("small")).toHaveText("1");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(1);
  const library = await page.evaluate(() => JSON.parse(localStorage.getItem("__cinebox_e2e_library") || "null"));
  expect(library.favorites).toEqual([-73223]);
  await page.reload();
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Ouvrir Black Clover" })).toBeVisible();
});

