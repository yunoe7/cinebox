import { expect, test, type Page } from "./fixtures";

/**
 * Child profiles must never see an unclassified or age-restricted title, and
 * favorites must follow the same rule without ever being deleted from storage.
 *
 * The D1 endpoint mock deliberately ignores `maxAge` so the browser-side
 * fail-closed filter is exercised as well as the server-side query parameter.
 */

const PROFILE_KEY = "cinebox-profiles";
const ADULT_ID = "p-cinebox-adult";
const CHILD_ID = "p-cinebox-child";

const LOCAL_FAMILY_FILM = {
  id: 93001,
  name: "Film familial local",
  kind: "Film",
  year: 2022,
  genre: "Famille",
  description: "Un film local classé pour les enfants.",
  poster: "",
  backdrop: "",
  progress: 0,
  duration: "90 min",
  minAge: 6,
  ageRating: "6",
};

const LOCAL_UNCLASSIFIED_FILM = {
  id: 93002,
  name: "Film non classé local",
  kind: "Film",
  year: 2021,
  genre: "Aventure",
  description: "Un film local sans classification.",
  poster: "",
  backdrop: "",
  progress: 0,
  duration: "95 min",
};

const LOCAL_ADULT_FILM = {
  id: 93003,
  name: "Film ado local",
  kind: "Film",
  year: 2020,
  genre: "Action",
  description: "Un film local classé au-dessus de la limite enfant.",
  poster: "",
  backdrop: "",
  progress: 0,
  duration: "110 min",
  minAge: 16,
};

const LOCAL_FAMILY_SERIES = {
  id: 93004,
  name: "Série familiale locale",
  kind: "Série",
  year: 2023,
  genre: "Animation",
  description: "Une série locale classée pour les enfants.",
  poster: "",
  backdrop: "",
  progress: 0,
  duration: "1 saison",
  minAge: 10,
  seasons: [{ number: 1, episodes: [{ number: 1, title: "Premier épisode" }] }],
};

const LOCAL_FAMILY_VIDEO = {
  id: 93005,
  name: "Vidéo familiale locale",
  kind: "Vidéo",
  year: 2024,
  genre: "Découverte",
  description: "Une vidéo locale tous publics.",
  poster: "",
  backdrop: "",
  progress: 0,
  duration: "12 min",
  ageRating: "TP",
};

const LOCAL_RECOMMENDATION = {
  id: 93006,
  name: "Recommandation familiale",
  kind: "Film",
  year: 2024,
  genre: "Famille",
  description: "Un contenu visible proposé en recommandation.",
  poster: "",
  backdrop: "",
  progress: 0,
  duration: "88 min",
  minAge: 0,
};

const LOCAL_FORBIDDEN_RECOMMENDATION = {
  id: 93007,
  name: "Recommandation interdite",
  kind: "Film",
  year: 2024,
  genre: "Famille",
  description: "Un contenu interdit qui ne doit jamais être recommandé.",
  poster: "",
  backdrop: "",
  progress: 0,
  duration: "88 min",
  minAge: 18,
};

const LOCAL_TITLES = [
  LOCAL_FAMILY_FILM,
  LOCAL_UNCLASSIFIED_FILM,
  LOCAL_ADULT_FILM,
  LOCAL_FAMILY_SERIES,
  LOCAL_FAMILY_VIDEO,
  LOCAL_RECOMMENDATION,
  LOCAL_FORBIDDEN_RECOMMENDATION,
];

const SHARED_ALLOWED_MOVIE = {
  id: "tmdb:movie:501",
  kind: "movie",
  title: "Le Film Partagé",
  overview: "Un film partagé tous publics.",
  releaseDate: "2021-03-12",
  posterPath: null,
  backdropPath: null,
  genres: ["Drame"],
  metadata: { tmdbId: 501, ageRating: "TP", minAge: 0 },
  seasons: [],
};

const SHARED_UNCLASSIFIED_SERIES = {
  id: "tmdb:series:73223",
  kind: "series",
  title: "Série non classée",
  overview: "Une série partagée sans classification.",
  releaseDate: "2017-10-03",
  posterPath: null,
  backdropPath: null,
  genres: ["Animation"],
  metadata: { tmdbId: 73223 },
  seasons: [{ number: 1, episodes: [{ number: 1, title: "Les garçons de la campagne" }] }],
};

const SHARED_ADULT_MOVIE = {
  id: "tmdb:movie:502",
  kind: "movie",
  title: "Le Film Adulte Partagé",
  overview: "Un film partagé classé 18+.",
  releaseDate: "2019-01-01",
  posterPath: null,
  backdropPath: null,
  genres: ["Thriller"],
  metadata: { tmdbId: 502, ageRating: "18" },
  seasons: [],
};

const SHARED_ALLOWED_VIDEO = {
  id: "tmdb:video:601",
  kind: "video",
  title: "La Vidéo Partagée",
  overview: "Une vidéo partagée tous publics.",
  releaseDate: "2022-07-01",
  posterPath: null,
  backdropPath: null,
  genres: ["Voyage"],
  metadata: { tmdbId: 601, minAge: 0 },
  seasons: [],
};

const SHARED_ROWS = [SHARED_ALLOWED_MOVIE, SHARED_UNCLASSIFIED_SERIES, SHARED_ADULT_MOVIE, SHARED_ALLOWED_VIDEO];

// Numeric ids resolved from the D1 ids above: 501, -73223, 502 and
// -(601 + 1e12). The last one is a safe integer but cannot be a viewCount key,
// which is why view counts only use positive movie ids.
const ALL_FAVORITES = [93001, 93002, 93003, 93004, 93005, 501, -73223, 502, -1000000000601];
const HIDDEN_FOR_CHILD = [93002, 93003, -73223, 502];
const HIDDEN_ONLY_FAVORITES = [93002, 93003, -73223, 502];

type SeedOptions = {
  favorites: number[];
  viewCounts?: Record<string, number>;
  playback?: Record<string, { assetKey?: string; currentTime: number; progress: number; episodes: Record<string, unknown> }>;
};

async function seed(page: Page, options: SeedOptions) {
  await page.addInitScript(({ titles, favorites, viewCounts, playback, profileKey, adultId, childId }) => {
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    if (window.localStorage.getItem("cinebox-titles") === null) {
      window.localStorage.setItem("cinebox-titles", JSON.stringify(titles));
      window.localStorage.setItem("cinebox-favorites", JSON.stringify(favorites));
    }
    if (window.localStorage.getItem(profileKey) === null) {
      const data = {
        favorites,
        playback,
        history: [],
        viewCounts,
        preferences: { autoplayNext: true },
      };
      window.localStorage.setItem(profileKey, JSON.stringify({
        version: 1,
        profiles: [
          { id: adultId, name: "Adulte", avatarId: "golden-reel", isChild: false, isPrimary: true, pin: null, createdAt: 1 },
          { id: childId, name: "Enfant", avatarId: "golden-reel", isChild: true, isPrimary: false, pin: null, createdAt: 2 },
        ],
        activeProfileId: adultId,
        data: { [adultId]: structuredClone(data), [childId]: structuredClone(data) },
      }));
    }
  }, {
    titles: LOCAL_TITLES,
    favorites: options.favorites,
    viewCounts: options.viewCounts ?? {},
    playback: options.playback ?? {},
    profileKey: PROFILE_KEY,
    adultId: ADULT_ID,
    childId: CHILD_ID,
  });
}

/** Simulates the public D1 endpoint and ignores `maxAge` on purpose. */
async function mockSharedCatalog(page: Page, rows: unknown[] = SHARED_ROWS) {
  await page.route(/\/api\/catalog\?/, async (route) => {
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

async function chooseProfile(page: Page, name: string) {
  await page.getByRole("button", { name: `Choisir le profil ${name}` }).click();
  await expect(page.locator("header").getByRole("button", { name: new RegExp(`^Profil actif : ${name}`) })).toBeVisible();
}

async function switchProfile(page: Page, name: string) {
  await page.locator("header").getByRole("button", { name: /^Profil actif : / }).click();
  await page.getByRole("menuitem", { name: /Quitter ce profil/ }).click();
  await expect(page.getByRole("heading", { name: "Qui regarde ?" })).toBeVisible();
  await chooseProfile(page, name);
}

async function openList(page: Page) {
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();
}

async function storedFavorites(page: Page, profileName: string): Promise<number[]> {
  return page.evaluate(({ key, name }) => {
    const store = JSON.parse(window.localStorage.getItem(key) || "null");
    const profile = store.profiles.find((item: { name: string }) => item.name === name);
    return store.data[profile.id].favorites;
  }, { key: PROFILE_KEY, name: profileName });
}

test("les favoris d’un enfant sont filtrés sans être supprimés et réapparaissent pour un adulte", async ({ page }) => {
  await seed(page, {
    favorites: ALL_FAVORITES,
    viewCounts: { "93001": 1, "93002": 9, "501": 2 },
    playback: {
      "93001": { assetKey: "93001:video", currentTime: 20, progress: 20, episodes: {} },
      "93002": { assetKey: "93002:video", currentTime: 40, progress: 40, episodes: {} },
    },
  });
  await mockSharedCatalog(page);
  await page.goto("/");

  // 5. Un profil adulte voit tous les contenus, y compris non classés.
  await chooseProfile(page, "Adulte");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();
  await expect(page.getByRole("button", { name: "Ouvrir Film non classé local" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Film ado local" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Adulte Partagé" })).toBeVisible();
  await page.locator(".sidebar .nav-item").filter({ hasText: "Séries" }).click();
  await expect(page.getByRole("button", { name: "Ouvrir Série non classée" })).toBeVisible();

  await switchProfile(page, "Enfant");
  await expect(page.getByText(/seuls les contenus dont la classification d’âge est connue et adaptée sont affichés/)).toBeVisible();

  // 1-4. Fail-closed sur l’accueil : local et D1 non classés ou trop âgés masqués,
  // contenus classés dans la limite visibles.
  await expect(page.getByRole("button", { name: "Ouvrir Film familial local" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Série familiale locale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Vidéo familiale locale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Partagé" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir La Vidéo Partagée" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Film non classé local" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir Film ado local" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir Série non classée" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Adulte Partagé" })).toHaveCount(0);

  // 9. Ni les recommandations, ni Reprendre, ni le Top 10 ne réintroduisent un interdit.
  await expect(page.locator(".discovery-card").filter({ hasText: "Recommandation familiale" })).toBeVisible();
  await expect(page.locator(".discovery-card").filter({ hasText: "Recommandation interdite" })).toHaveCount(0);
  await expect(page.locator(".continue-card").filter({ hasText: "Film familial local" })).toBeVisible();
  await expect(page.locator(".continue-card").filter({ hasText: "Film non classé local" })).toHaveCount(0);
  await expect(page.locator(".top-ten-row").filter({ hasText: "Le Film Partagé" })).toBeVisible();
  await expect(page.locator(".top-ten-row").filter({ hasText: "Film non classé local" })).toHaveCount(0);

  // 9. La recherche ne contourne pas le filtre, pour le local comme pour D1.
  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();
  const filmSearch = page.getByRole("textbox", { name: "Rechercher dans ma collection" });
  await filmSearch.fill("non classé");
  await expect(page.locator(".films-result-count")).toContainText("0 résultat");
  await expect(page.getByRole("button", { name: "Ouvrir Film non classé local" })).toHaveCount(0);
  await expect(page.getByText("Aucun film ne correspond à votre recherche")).toBeVisible();
  await filmSearch.fill("ado");
  await expect(page.locator(".films-result-count")).toContainText("0 résultat");
  await expect(page.getByRole("button", { name: "Ouvrir Film ado local" })).toHaveCount(0);
  await filmSearch.fill("");

  await page.locator(".sidebar .nav-item").filter({ hasText: "Séries" }).click();
  const seriesSearch = page.getByRole("textbox", { name: "Rechercher une série" });
  await seriesSearch.fill("non classée");
  await expect(page.locator(".films-result-count")).toContainText("0 résultat");
  await expect(page.getByRole("button", { name: "Ouvrir Série non classée" })).toHaveCount(0);
  await seriesSearch.fill("");

  // 6-7. Ma liste enfant : uniquement les favoris visibles, compteurs cohérents.
  await openList(page);
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(5);
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).locator("small")).toHaveText("5");
  await expect(page.getByText("5 favoris dans votre liste")).toBeVisible();
  await expect(page.locator(".films-result-count")).toContainText("5 affichés sur 5 favoris");
  await expect(page.getByRole("button", { name: "Films, 2 favoris" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Séries, 1 favoris" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vidéos, 2 favoris" })).toBeVisible();
  await expect(page.locator(".list-type-filters button").filter({ hasText: "Tout" }).locator("small")).toHaveText("5");

  for (const name of ["Film familial local", "Série familiale locale", "Vidéo familiale locale", "Le Film Partagé", "La Vidéo Partagée"]) {
    await expect(page.getByRole("button", { name: `Ouvrir ${name}` })).toBeVisible();
  }
  for (const name of ["Film non classé local", "Film ado local", "Série non classée", "Le Film Adulte Partagé"]) {
    await expect(page.getByRole("button", { name: `Ouvrir ${name}` })).toHaveCount(0);
  }

  // 6. Les favoris masqués restent enregistrés, pour l’enfant comme pour l’adulte.
  expect(await storedFavorites(page, "Enfant")).toEqual(ALL_FAVORITES);
  expect(await storedFavorites(page, "Adulte")).toEqual(ALL_FAVORITES);

  // 8. Retour au profil adulte : tous les favoris réapparaissent.
  await switchProfile(page, "Adulte");
  await openList(page);
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(9);
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).locator("small")).toHaveText("9");
  await expect(page.getByText("9 favoris dans votre liste")).toBeVisible();
  await expect(page.locator(".films-result-count")).toContainText("9 affichés sur 9 favoris");
  await expect(page.getByRole("button", { name: "Films, 5 favoris" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Séries, 2 favoris" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vidéos, 2 favoris" })).toBeVisible();
  for (const name of ["Film non classé local", "Film ado local", "Série non classée", "Le Film Adulte Partagé"]) {
    await expect(page.getByRole("button", { name: `Ouvrir ${name}` })).toBeVisible();
  }

  // L’accueil adulte retrouve aussi les contenus masqués en mode enfant.
  await page.locator(".sidebar .nav-item").filter({ hasText: "Accueil" }).click();
  await expect(page.locator(".continue-card").filter({ hasText: "Film non classé local" })).toBeVisible();
  await expect(page.locator(".top-ten-row").filter({ hasText: "Film non classé local" })).toBeVisible();

  expect(await storedFavorites(page, "Enfant")).toEqual(ALL_FAVORITES);
  expect(await storedFavorites(page, "Adulte")).toEqual(ALL_FAVORITES);
});

test("un enfant dont tous les favoris sont masqués voit une liste vide mais conserve ses données", async ({ page }) => {
  await seed(page, {
    favorites: HIDDEN_ONLY_FAVORITES,
    viewCounts: { "93002": 9 },
    playback: { "93002": { assetKey: "93002:video", currentTime: 40, progress: 40, episodes: {} } },
  });
  await mockSharedCatalog(page);
  await page.goto("/");
  await chooseProfile(page, "Enfant");

  await openList(page);
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(0);
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).locator("small")).toHaveText("0");
  await expect(page.getByText("0 favoris dans votre liste")).toBeVisible();
  await expect(page.locator(".films-result-count")).toContainText("0 affichés sur 0 favoris");
  await expect(page.getByRole("button", { name: "Films, 0 favoris" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Séries, 0 favoris" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vidéos, 0 favoris" })).toBeVisible();
  await expect(page.getByText("Aucun favori visible pour ce profil")).toBeVisible();
  await expect(page.getByText(/Ils restent enregistrés et réapparaîtront sur un profil adulte/)).toBeVisible();
  for (const name of ["Film non classé local", "Film ado local", "Série non classée", "Le Film Adulte Partagé"]) {
    await expect(page.getByRole("button", { name: `Ouvrir ${name}` })).toHaveCount(0);
  }
  expect(await storedFavorites(page, "Enfant")).toEqual(HIDDEN_ONLY_FAVORITES);

  await switchProfile(page, "Adulte");
  await openList(page);
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(4);
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).locator("small")).toHaveText("4");
  await expect(page.getByRole("button", { name: "Films, 3 favoris" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Séries, 1 favoris" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vidéos, 0 favoris" })).toBeVisible();
  for (const name of ["Film non classé local", "Film ado local", "Série non classée", "Le Film Adulte Partagé"]) {
    await expect(page.getByRole("button", { name: `Ouvrir ${name}` })).toBeVisible();
  }
  expect(await storedFavorites(page, "Enfant")).toEqual(HIDDEN_ONLY_FAVORITES);
});
