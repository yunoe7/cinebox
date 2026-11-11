import { expect, test, type Page } from "@playwright/test";

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

const emptyProfileData = { favorites: [], playback: {}, history: [], viewCounts: {}, preferences: { autoplayNext: true } };

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

async function seedProfiles(page: Page, options: { child?: boolean } = {}) {
  await page.addInitScript(({ child, data }) => {
    if (window.localStorage.getItem("cinebox-profiles") !== null) return;
    const mainId = "p-cinebox-main";
    const otherId = "p-cinebox-other";
    const profiles = child
      ? [{ id: mainId, name: "Enfant", avatarId: "golden-reel", isChild: true, isPrimary: true, pin: null, createdAt: 1 }]
      : [
          { id: mainId, name: "Principal", avatarId: "golden-reel", isChild: false, isPrimary: true, pin: null, createdAt: 1 },
          { id: otherId, name: "Secondaire", avatarId: "golden-reel", isChild: false, isPrimary: false, pin: null, createdAt: 2 },
        ];
    localStorage.setItem("cinebox-profiles", JSON.stringify({
      version: 1,
      profiles,
      activeProfileId: mainId,
      data: { [mainId]: structuredClone(data), ...(child ? {} : { [otherId]: structuredClone(data) }) },
    }));
  }, { child: Boolean(options.child), data: emptyProfileData });
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

async function chooseProfile(page: Page, name: string) {
  await page.getByRole("button", { name: `Choisir le profil ${name}` }).click();
  await expect(page.locator("header").getByRole("button", { name: new RegExp(`^Profil actif : ${name}`) })).toBeVisible();
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

test("un favori D1 est immédiat, persistant et isolé par profil", async ({ page }) => {
  await seedLocalLibrary(page);
  await seedProfiles(page);
  await mockSharedCatalog(page, [SHARED_MOVIE, SHARED_BLACK_CLOVER, SHARED_VIDEO]);
  await page.goto("/");
  await chooseProfile(page, "Principal");

  await page.locator(".sidebar .nav-item").filter({ hasText: "Séries" }).click();
  await page.getByRole("button", { name: "Ajouter Black Clover aux favoris" }).click();
  await expect(page.getByRole("button", { name: "Retirer Black Clover des favoris" })).toBeVisible();
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).locator("small")).toHaveText("1");

  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Ouvrir Black Clover" })).toBeVisible();

  const principalFavorites = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("cinebox-profiles") || "null");
    const profile = store.profiles.find((item: { name: string }) => item.name === "Principal");
    return store.data[profile.id].favorites;
  });
  expect(principalFavorites).toEqual([-73223]);

  await page.reload();
  await chooseProfile(page, "Principal");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Ouvrir Black Clover" })).toBeVisible();

  await page.locator("header").getByRole("button", { name: /^Profil actif : / }).click();
  await page.getByRole("menuitem", { name: /Quitter ce profil/ }).click();
  await chooseProfile(page, "Secondaire");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(0);
  await expect(page.getByText("Votre liste commence avec vos coups de cœur")).toBeVisible();

  await page.locator("header").getByRole("button", { name: /^Profil actif : / }).click();
  await page.getByRole("menuitem", { name: /Quitter ce profil/ }).click();
  await chooseProfile(page, "Principal");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Ma liste" }).click();
  await expect(page.locator(".ma-list-poster-grid .favorite-card")).toHaveCount(1);
});

test("un profil enfant ne voit que les contenus classés et adaptés", async ({ page }) => {
  await seedLocalLibrary(page, [
    { id: 92001, name: "Titre familial", kind: "Film", year: 2020, genre: "Comédie", description: "", poster: "", backdrop: "", progress: 0, duration: "80 min", minAge: 6, ageRating: "6" },
    { id: 92002, name: "Archive horreur", kind: "Film", year: 2020, genre: "Horreur", description: "", poster: "", backdrop: "", progress: 0, duration: "90 min" },
    { id: 92003, name: "Titre local non classé", kind: "Film", year: 2020, genre: "Comédie", description: "", poster: "", backdrop: "", progress: 0, duration: "85 min" },
  ]);
  await seedProfiles(page, { child: true });
  const requests: string[] = [];
  await mockSharedCatalog(page, [SHARED_MOVIE, SHARED_BLACK_CLOVER, SHARED_ADULT_MOVIE], requests);
  await page.goto("/");

  await expect(page.getByText(/Mode enfant : seuls les contenus dont la classification d’âge est connue et adaptée sont affichés/)).toBeVisible();
  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();
  await expect(page.getByRole("button", { name: "Ouvrir Titre familial" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Partagé" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir Archive horreur" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir Titre local non classé" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir Black Clover" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Adulte Partagé" })).toHaveCount(0);
  await expect(page.locator(".sidebar .nav-item").filter({ hasText: "Administration" })).toHaveCount(0);

  expect(requests.some((url) => /[?&]maxAge=10(&|$)/.test(url))).toBe(true);
});

test("les barres de recherche ne débordent pas sur mobile", async ({ page }) => {
  await seedLocalLibrary(page);
  await mockSharedCatalog(page, [SHARED_MOVIE, SHARED_BLACK_CLOVER, SHARED_VIDEO]);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });

  for (const section of ["Accueil", "Films", "Séries", "Vidéos", "Ma liste"]) {
    await page.locator(".mobile-bottom-nav button").filter({ hasText: section }).click();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content, section).toBeLessThanOrEqual(dimensions.viewport);
  }

  await page.locator(".mobile-bottom-nav button").filter({ hasText: "Séries" }).click();
  const search = page.getByRole("textbox", { name: "Rechercher une série" });
  await expect(search).toBeVisible();
  const searchBar = page.locator(".top-actions .search");
  const box = await searchBar.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(96);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
});

test("une panne du catalogue partagé reste explicite et le bouton Réessayer recharge les fiches", async ({ page }) => {
  await seedLocalLibrary(page);
  let failing = true;
  const requests: string[] = [];
  await page.route(/\/api\/catalog\?/, async (route) => {
    requests.push(route.request().url());
    if (failing) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "D1 indisponible" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ titles: [SHARED_MOVIE], stats: { titles: 1, films: 1, series: 0, videos: 0, episodes: 0 } }),
    });
  });
  await page.goto("/");

  // The local library must stay usable while the shared catalogue fails.
  await expect(page.getByRole("button", { name: "Ouvrir Le Voyage Bleu" })).toBeVisible();
  const banner = page.locator(".shared-catalog-status.is-error");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Catalogue partagé indisponible");
  await expect(banner).toContainText("Votre bibliothèque locale reste accessible");
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Partagé" })).toHaveCount(0);

  failing = false;
  await banner.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.locator(".shared-catalog-status")).toHaveCount(0);
  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Partagé" })).toBeVisible();
  expect(requests.length).toBeGreaterThanOrEqual(2);
});

test("un catalogue partagé vide n’est pas présenté comme une panne", async ({ page }) => {
  await seedLocalLibrary(page);
  await mockSharedCatalog(page, []);
  await page.goto("/");

  await expect(page.locator(".shared-catalog-status")).toHaveCount(0);
  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();
  await expect(page.getByRole("button", { name: "Ouvrir Le Voyage Bleu" })).toBeVisible();
  await expect(page.getByText("Votre cinémathèque commence ici")).toHaveCount(0);
});

test("un échec du catalogue partagé ne laisse jamais de fiches adultes à un profil enfant", async ({ page }) => {
  await seedLocalLibrary(page);
  await page.addInitScript(({ data }) => {
    if (window.localStorage.getItem("cinebox-profiles") !== null) return;
    const adultId = "p-cinebox-adult";
    const childId = "p-cinebox-child";
    window.localStorage.setItem("cinebox-profiles", JSON.stringify({
      version: 1,
      profiles: [
        { id: adultId, name: "Adulte", avatarId: "golden-reel", isChild: false, isPrimary: true, pin: null, createdAt: 1 },
        { id: childId, name: "Enfant", avatarId: "golden-reel", isChild: true, isPrimary: false, pin: null, createdAt: 2 },
      ],
      activeProfileId: adultId,
      data: { [adultId]: structuredClone(data), [childId]: structuredClone(data) },
    }));
  }, { data: emptyProfileData });

  let failing = false;
  await page.route(/\/api\/catalog\?/, async (route) => {
    if (failing) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "D1 indisponible" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ titles: [SHARED_MOVIE], stats: { titles: 1, films: 1, series: 0, videos: 0, episodes: 0 } }),
    });
  });
  await page.goto("/");
  // Two profiles exist, so the app intentionally starts on the gate.
  await chooseProfile(page, "Adulte");

  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();
  await expect(page.getByRole("button", { name: "Ouvrir Le Film Partagé" })).toBeVisible();

  // The next shared-catalogue request fails while switching to a child profile.
  failing = true;
  await page.locator("header").getByRole("button", { name: /^Profil actif : / }).click();
  await page.getByRole("menuitem", { name: /Quitter ce profil/ }).click();
  await page.getByRole("button", { name: "Choisir le profil Enfant" }).click();
  await page.locator(".sidebar .nav-item").filter({ hasText: "Films" }).click();

  await expect(page.getByRole("button", { name: "Ouvrir Le Film Partagé" })).toHaveCount(0);
  await expect(page.locator(".shared-catalog-status.is-error")).toBeVisible();
  await expect(page.getByText(/Mode enfant : seuls les contenus/)).toBeVisible();
});
