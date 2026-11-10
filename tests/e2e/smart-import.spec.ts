import { expect, test, type Page } from "@playwright/test";

const movieSearch = { results: [
  { id: 71001, media_type: "movie", title: "Étoiles", original_title: "Stars", release_date: "2020-04-01", original_language: "en", overview: "Correspondance A", poster_path: "/poster-a.jpg", vote_average: 8.479, vote_count: 100 },
  { id: 71002, media_type: "movie", title: "Étoiles", original_title: "Hoshi", release_date: "2023-06-02", original_language: "ja", overview: "Correspondance B", poster_path: null, vote_average: 6.8, vote_count: 40 },
] };
const tvSearch = { results: [{ id: 72001, media_type: "tv", name: "La Station", original_name: "Station", first_air_date: "2021-01-12", original_language: "fr", overview: "Série synthétique", poster_path: "/poster-tv.jpg", backdrop_path: "/backdrop-tv.jpg", vote_average: 8.1, vote_count: 90 }] };
const ratingSearch = { results: [
  { id: 71003, media_type: "movie", title: "Note absente", original_title: "Missing Rating", release_date: "2022-01-01", vote_count: 0 },
  { id: 71004, media_type: "movie", title: "Note invalide", original_title: "Invalid Rating", release_date: "2022-01-01", vote_average: "invalide", vote_count: 0 },
] };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kWQAAAAASUVORK5CYII=", "base64");

async function installMocks(page: Page) {
  await page.route("**/api/tmdb/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/search")) {
      if (url.searchParams.get("query") === "Notes") return route.fulfill({ json: ratingSearch });
      const kind = url.searchParams.get("kind");
      return route.fulfill({ json: kind === "tv" ? tvSearch : movieSearch });
    }
    if (path.endsWith("/image")) return route.fulfill({ status: 200, contentType: "image/png", body: png });
    if (path.endsWith("/movie/71001")) return route.fulfill({ json: { ...movieSearch.results[0], genres: [{ id: 18, name: "Drame" }], runtime: 113, backdrop_path: "/backdrop.jpg", production_countries: [{ name: "France" }], credits: { cast: [{ name: "Actrice Test", order: 0 }], crew: [{ name: "Réalisateur Test", job: "Director" }] } } });
    if (path.endsWith("/movie/71002")) return route.fulfill({ json: { ...movieSearch.results[1], overview: "", genres: [], runtime: null, backdrop_path: null, credits: { cast: [], crew: [] } } });
    if (path.endsWith("/movie/71003")) return route.fulfill({ json: { ...ratingSearch.results[0], genres: [], credits: { cast: [], crew: [] } } });
    if (path.endsWith("/movie/71004")) return route.fulfill({ json: { ...ratingSearch.results[1], genres: [], credits: { cast: [], crew: [] } } });
    if (path.endsWith("/tv/72001")) return route.fulfill({ json: { ...tvSearch.results[0], genres: [{ id: 80, name: "Polar" }], number_of_seasons: 2, number_of_episodes: 3, status: "Ended", seasons: [{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }] } });
    if (path.includes("/season/0")) return route.fulfill({ json: { id: 0, season_number: 0, name: "Spéciaux", episodes: [{ id: 1, episode_number: 1, name: "Bonus", air_date: "2020-01-01" }] } });
    if (path.includes("/season/1")) return route.fulfill({ json: { id: 11, season_number: 1, name: "Première saison", overview: "Saison une", poster_path: "/season1.jpg", episodes: [{ id: 101, episode_number: 1, name: "Arrivée", air_date: "2021-01-12", still_path: "/still1.jpg", runtime: 42 }, { id: 102, episode_number: 2, name: "Départ", air_date: "2099-01-12" }] } });
    if (path.includes("/season/2")) return route.fulfill({ json: { id: 12, season_number: 2, name: "Deuxième saison", episodes: [{ id: 201, episode_number: 1, name: "Retour" }] } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("smart-import-fixture-ready")) {
      localStorage.setItem("cinebox-titles", "[]");
      localStorage.setItem("cinebox-favorites", "[]");
      sessionStorage.setItem("smart-import-fixture-ready", "true");
    }
  });
  await installMocks(page);
  await page.goto("/");
});

test("la recherche affiche les homonymes et préremplit les métadonnées du film choisi", async ({ page }) => {
  await page.locator(".add-btn").click();
  await page.getByRole("textbox", { name: "Rechercher un film ou une série" }).fill("Étoiles");
  await expect(page.getByRole("button", { name: /Étoiles/ })).toHaveCount(2);
  await page.getByRole("button", { name: /Choisir Étoiles/ }).first().click();
  await expect(page.getByRole("heading", { name: "Étoiles" })).toBeVisible();
  await expect(page.getByText("Correspondance A")).toBeVisible();
  await page.getByRole("button", { name: "Préremplir le formulaire" }).click();
  await expect(page.locator('input[name="name"]')).toHaveValue("Étoiles");
  await expect(page.locator('textarea[name="description"]')).toHaveValue("Correspondance A");
  await expect(page.locator('input[name="genre"]')).toHaveValue("Drame");
  await expect(page.getByLabel("Réalisateur", { exact: true })).toHaveValue("Réalisateur Test");
  await expect(page.locator('input[name="smartAsset:smart:backdrop"]')).toHaveCount(1);
});

test("préserve la précision de la note TMDB, permet sa modification et la sauvegarde", async ({ page }) => {
  await page.locator(".add-btn").click();
  await page.getByRole("textbox", { name: "Rechercher un film ou une série" }).fill("Étoiles");
  await page.getByRole("button", { name: /Choisir Étoiles/ }).first().click();
  await expect(page.locator(".smart-import-preview")).toContainText("8.479 (100)");
  await page.getByRole("button", { name: "Préremplir le formulaire" }).click();
  const rating = page.getByLabel("Note TMDB");
  await expect(rating).toHaveValue("8.479");
  expect(await rating.evaluate(element => (element as HTMLInputElement).checkValidity())).toBe(true);
  await rating.fill("8.125");
  expect(await rating.evaluate(element => (element as HTMLInputElement).checkValidity())).toBe(true);
  await expect(page.locator(".smart-import-metadata small").filter({ hasText: "TMDB #71001" })).toContainText("8.125 (100 votes)");
  await page.getByRole("button", { name: "Ajouter à ma collection" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cinebox-titles") || "[]")[0]?.rating)).toBe(8.125);
});

test("les notes TMDB absentes ou invalides restent affichées et importables sans NaN", async ({ page }) => {
  await page.locator(".add-btn").click();
  await page.getByRole("textbox", { name: "Rechercher un film ou une série" }).fill("Notes");
  await expect(page.getByRole("button", { name: /Choisir Note absente/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Choisir Note invalide/ })).toContainText("—");

  await page.getByRole("button", { name: /Choisir Note absente/ }).click();
  await expect(page.locator(".smart-import-preview")).toContainText("— (0)");
  await page.getByRole("button", { name: "Préremplir le formulaire" }).click();
  await expect(page.getByLabel("Note TMDB")).toHaveValue("0");
  await expect(page.locator(".smart-import-metadata small").filter({ hasText: "TMDB #71003" })).toContainText("0 (0 votes)");

  await page.getByRole("button", { name: "Retour aux résultats" }).click();
  await page.getByRole("button", { name: /Choisir Note invalide/ }).click();
  await expect(page.locator(".smart-import-preview")).toContainText("— (0)");
  await page.getByRole("button", { name: "Préremplir le formulaire" }).click();
  await expect(page.getByLabel("Note TMDB")).toHaveValue("0");
  await expect(page.locator(".smart-import-metadata small").filter({ hasText: "TMDB #71004" })).toContainText("0 (0 votes)");
});

test("la série importe ses saisons et épisodes, en laissant les saisons spéciales optatives", async ({ page }) => {
  await page.locator(".add-btn").click();
  await page.getByRole("combobox", { name: "Type de recherche" }).selectOption("tv");
  await page.getByRole("textbox", { name: "Rechercher un film ou une série" }).fill("La Station");
  await page.getByRole("button", { name: /Choisir La Station/ }).click();
  await expect(page.getByText("Saisons à importer")).toBeVisible();
  await expect(page.getByLabel(/Saison 0/)).not.toBeChecked();
  await expect(page.getByLabel(/Saison 1/)).toBeChecked();
  await page.getByLabel(/Saison 2/).uncheck();
  await page.getByRole("button", { name: "Préremplir le formulaire" }).click();
  await expect(page.locator('select[name="kind"]')).toHaveValue("Série");
  await expect(page.locator('input[name="seasonCount"]')).toHaveValue("1");
  await expect(page.locator('textarea[name="episodeTitles"]')).toHaveValue("Arrivée\nDépart");
  const serialized = await page.locator('input[name="smartImport"]').inputValue();
  const data = JSON.parse(serialized);
  expect(data.seasons.map((season: { number: number }) => season.number)).toEqual([1]);
  expect(data.seasons[0].episodes[1].airDate).toBe("2099-01-12");
  await page.getByRole("button", { name: "Ajouter à ma collection" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cinebox-titles") || "[]"))).toMatchObject([
    expect.objectContaining({ tmdbId: 72001, backdropAssetKey: expect.any(String), posterAssetKey: expect.any(String), seasons: [expect.objectContaining({ number: 1, posterAssetKey: expect.any(String), episodes: [expect.objectContaining({ tmdbId: 101, thumbnailAssetKey: expect.any(String) }), expect.objectContaining({ title: "Départ", airDate: "2099-01-12" })] })] }),
  ]);
  const localImageCount = await page.evaluate(async () => {
    const title = JSON.parse(localStorage.getItem("cinebox-titles") || "[]")[0];
    const keys = [title.posterAssetKey, title.backdropAssetKey, title.seasons[0].posterAssetKey, title.seasons[0].episodes[0].thumbnailAssetKey];
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("cinebox-assets", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const exists = await Promise.all(keys.map(key => new Promise<boolean>((resolve, reject) => { const request = db.transaction("files", "readonly").objectStore("files").get(key); request.onsuccess = () => resolve(request.result instanceof Blob && request.result.type === "image/png"); request.onerror = () => reject(request.error); })));
    db.close();
    return exists.filter(Boolean).length;
  });
  expect(localImageCount).toBe(4);
});

test("une mise à jour existante conserve les références vidéo et la progression", async ({ page }) => {
  const seeded = [{ id: 88001, name: "Étoiles", kind: "Film", year: 2020, genre: "Ancien", description: "Ancien résumé", poster: "", backdrop: "", progress: 43, currentTime: 51, duration: "100 min", videoAssetKey: "88001:video:v:personal", viewCount: 7, tmdbId: 71001 }];
  await page.evaluate(value => localStorage.setItem("cinebox-titles", JSON.stringify(value)), seeded);
  await page.evaluate(() => localStorage.removeItem("cinebox-profiles"));
  await page.evaluate(() => localStorage.setItem("cinebox-favorites", "[88001]"));
  await page.reload();
  await page.locator(".add-btn").click();
  await page.getByRole("textbox", { name: "Rechercher un film ou une série" }).fill("Étoiles");
  await page.getByRole("button", { name: /Choisir Étoiles/ }).first().click();
  await expect(page.getByText(/déjà dans votre bibliothèque/)).toBeVisible();
  await page.getByRole("button", { name: "Mettre à jour ce titre" }).click();
  await page.getByRole("button", { name: "Enregistrer les modifications" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cinebox-titles") || "[]"))).toMatchObject([
    expect.objectContaining({ id: 88001, tmdbId: 71001, progress: 43, currentTime: 51, videoAssetKey: "88001:video:v:personal", viewCount: 7, name: "Étoiles" }),
  ]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cinebox-favorites"))).toBe("[88001]");
});

test("un titre sans affiche ni résumé reste importable", async ({ page }) => {
  await page.locator(".add-btn").click();
  await page.getByRole("textbox", { name: "Rechercher un film ou une série" }).fill("Étoiles");
  await page.getByRole("button", { name: /Choisir Étoiles/ }).nth(1).click();
  await expect(page.getByText("Sans affiche")).toBeVisible();
  await expect(page.getByText("Aucun résumé fourni.")).toBeVisible();
  await page.getByRole("button", { name: "Préremplir le formulaire" }).click();
  await expect(page.locator('input[name="name"]')).toHaveValue("Étoiles");
  const fileCount = await page.locator(".add-form input[type=file]").first().evaluate(element => (element as HTMLInputElement).files?.length || 0);
  expect(fileCount).toBe(0);
});

test("une panne réseau est affichée sans bloquer le formulaire manuel", async ({ page }) => {
  await page.route("**/api/tmdb/search**", route => route.abort());
  await page.locator(".add-btn").click();
  await page.getByRole("textbox", { name: "Rechercher un film ou une série" }).fill("Indisponible");
  await expect(page.locator(".smart-import-error")).toContainText("Connexion au catalogue impossible");
  await expect(page.locator('input[name="name"]')).toBeVisible();
});

test("la recherche Smart Import reste utilisable sur un écran mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".add-btn").click();
  const search = page.getByRole("textbox", { name: "Rechercher un film ou une série" });
  await expect(search).toBeVisible();
  await search.fill("Étoiles");
  await expect(page.getByRole("button", { name: /Choisir Étoiles/ }).first()).toBeVisible();
  const size = await page.locator(".add-modal").evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client);
});
