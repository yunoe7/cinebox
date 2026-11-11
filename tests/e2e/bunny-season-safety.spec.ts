import { expect, test, type Page } from "@playwright/test";

const VIDEO_ID = "0123456789abcdef0123456789abcdef";
const TMDB_ID = 42;
const SERIES_TITLE = "Ma Série";
const VIDEO_TITLE = "Ma Série S01E02";

type TmdbEpisode = {
  id: number;
  episode_number: number;
  name: string;
  overview: string;
  air_date: string;
  runtime: number;
  still_path: string | null;
};

function tmdbEpisode(number: number, id = 1000 + number): TmdbEpisode {
  return {
    id,
    episode_number: number,
    name: `Épisode ${number}`,
    overview: `Résumé ${number}`,
    air_date: "2020-01-01",
    runtime: 24,
    still_path: `/still-${number}.jpg`,
  };
}

function seasonPayload(episodes: TmdbEpisode[], seasonNumber = 1) {
  return {
    season_number: seasonNumber,
    name: `Saison ${seasonNumber}`,
    overview: `Synopsis saison ${seasonNumber}`,
    air_date: "2020-01-01",
    episodes,
  };
}

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

async function setupRoutes(
  page: Page,
  {
    episodeCount,
    season,
    seasonStatus = 200,
    seasonError = "TMDB indisponible pour cette saison.",
  }: {
    episodeCount: number;
    season: ReturnType<typeof seasonPayload>;
    seasonStatus?: number;
    seasonError?: string;
  },
) {
  const publishBodies: Array<Record<string, unknown>> = [];

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill(json({ authenticated: true, configured: true }));
  });

  await page.route("**/api/bunny/videos", async (route) => {
    await route.fulfill(json({
      libraryId: "library-e2e",
      total: 1,
      videos: [{
        id: VIDEO_ID,
        title: VIDEO_TITLE,
        durationSeconds: 1500,
        thumbnailUrl: null,
        status: 4,
      }],
    }));
  });

  await page.route("**/api/tmdb/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/tmdb/search") {
      await route.fulfill(json({
        results: [{
          id: TMDB_ID,
          media_type: "tv",
          name: SERIES_TITLE,
          first_air_date: "2020-01-01",
          poster_path: null,
          overview: "Une série de test.",
          vote_average: 8.1,
        }],
      }));
      return;
    }
    if (path === `/api/tmdb/tv/${TMDB_ID}`) {
      await route.fulfill(json({
        id: TMDB_ID,
        name: SERIES_TITLE,
        overview: "Une série de test.",
        first_air_date: "2020-01-01",
        poster_path: null,
        backdrop_path: null,
        genres: [{ id: 18, name: "Drame" }],
        vote_average: 8.1,
        vote_count: 120,
        credits: { cast: [{ name: "Acteur", character: "Rôle" }], crew: [{ name: "Réalisatrice", job: "Director" }] },
        seasons: [{ season_number: 1, name: "Saison 1", episode_count: episodeCount, air_date: "2020-01-01" }],
      }));
      return;
    }
    if (path === `/api/tmdb/tv/${TMDB_ID}/reviews`) {
      await route.fulfill(json({ results: [] }));
      return;
    }
    if (path === `/api/tmdb/tv/${TMDB_ID}/season/1`) {
      await route.fulfill(json(seasonStatus === 200 ? season : { error: seasonError }, seasonStatus));
      return;
    }
    await route.fulfill(json({ error: "Route TMDB non simulée." }, 404));
  });

  await page.route("**/api/catalog/publish", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    publishBodies.push(body);
    const mode = body.replaceSeason === true ? "replaceSeason" : "upsert";
    const seasons = Array.isArray(body.seasons) ? body.seasons as Array<{ episodes?: unknown[] }> : [];
    await route.fulfill(json({
      published: true,
      id: `tmdb:series:${TMDB_ID}`,
      kind: "series",
      mode,
      episodesPublished: seasons[0]?.episodes?.length ?? 0,
      episodesDeleted: 0,
    }));
  });

  return { publishBodies };
}

async function openBunnyPanel(page: Page) {
  await page.goto("/");
  await page.locator(".sidebar .nav-item").filter({ hasText: "Administration" }).click();
  await page.locator(".admin-section-nav").getByRole("button", { name: "Médias" }).click();
  const panel = page.locator(".bunny-panel");
  await expect(panel).toBeVisible();
  await panel.locator(".bunny-list-item").filter({ hasText: VIDEO_TITLE }).click();
  await panel.locator(".bunny-hit").filter({ hasText: SERIES_TITLE }).click();
  return panel;
}

test("annuler la confirmation d’une saison complète ne publie rien", async ({ page }) => {
  const { publishBodies } = await setupRoutes(page, {
    episodeCount: 3,
    season: seasonPayload([tmdbEpisode(1), tmdbEpisode(2), tmdbEpisode(3)]),
  });
  const panel = await openBunnyPanel(page);

  await expect(panel.locator(".bunny-season-notice")).toContainText("Saison vérifiée complète");
  await expect(panel.locator(".bunny-season-notice")).toContainText("remplacera le contenu D1");
  await expect(panel.locator(".bunny-season-notice")).toContainText("fichiers Bunny ne seront pas supprimés");

  let dialogMessage = "";
  page.once("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.dismiss();
  });
  await panel.getByRole("button", { name: "Remplacer la saison et associer la vidéo" }).click();

  await expect(panel.getByText(/Publication annulée/)).toBeVisible();
  expect(dialogMessage).toContain("retirés de D1");
  expect(dialogMessage).toContain("fichiers Bunny ne seront pas supprimés");
  expect(publishBodies).toHaveLength(0);
});

test("confirmer une saison complète envoie replaceSeason vrai et la saison ciblée", async ({ page }) => {
  const { publishBodies } = await setupRoutes(page, {
    episodeCount: 3,
    season: seasonPayload([tmdbEpisode(1), tmdbEpisode(2), tmdbEpisode(3)]),
  });
  const panel = await openBunnyPanel(page);

  await expect(panel.locator(".bunny-season-notice")).toContainText("Saison vérifiée complète");
  let dialogMessage = "";
  page.once("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });
  await panel.getByRole("button", { name: "Remplacer la saison et associer la vidéo" }).click();

  await expect(panel.getByText(/Saison remplacée/)).toBeVisible();
  expect(dialogMessage).toContain("retirés de D1");
  expect(publishBodies).toHaveLength(1);
  const body = publishBodies[0];
  expect(body.replaceSeason).toBe(true);
  expect(body.targetEpisode).toEqual({ seasonNumber: 1, episodeNumber: 2 });
  expect(body.bunnyVideoId).toBe(VIDEO_ID);
  const seasons = body.seasons as Array<{ number: number; episodes: Array<{ number: number; tmdbId: number }> }>;
  expect(seasons).toHaveLength(1);
  expect(seasons[0].number).toBe(1);
  expect(seasons[0].episodes.map((episode) => episode.number)).toEqual([1, 2, 3]);
  expect(seasons[0].episodes[1].tmdbId).toBe(1002);
});

test("une saison incomplète est publiée en upsert sans confirmation ni remplacement", async ({ page }) => {
  const { publishBodies } = await setupRoutes(page, {
    episodeCount: 3,
    season: seasonPayload([tmdbEpisode(1), tmdbEpisode(2)]),
  });
  const panel = await openBunnyPanel(page);

  await expect(panel.locator(".bunny-season-notice")).toContainText("Synchronisation non destructive");
  await expect(panel.locator(".bunny-season-notice")).toContainText("conservés");

  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs += 1;
    await dialog.dismiss();
  });
  await panel.getByRole("button", { name: "Publier la fiche et associer la vidéo" }).click();

  await expect(panel.getByText(/mode non destructif/)).toBeVisible();
  expect(dialogs).toBe(0);
  expect(publishBodies).toHaveLength(1);
  const body = publishBodies[0];
  expect(body.replaceSeason).toBe(false);
  const seasons = body.seasons as Array<{ episodes: unknown[] }>;
  expect(seasons[0].episodes).toHaveLength(2);
});

test("des numéros d’épisodes dupliqués bloquent la publication dans l’interface", async ({ page }) => {
  const { publishBodies } = await setupRoutes(page, {
    episodeCount: 3,
    season: seasonPayload([tmdbEpisode(1), tmdbEpisode(1, 2002), tmdbEpisode(3)]),
  });
  const panel = await openBunnyPanel(page);

  await expect(panel.locator(".bunny-season-notice")).toContainText("Publication bloquée");
  await expect(panel.locator(".bunny-season-notice")).toContainText("même numéro");
  await expect(panel.getByRole("button", { name: "Publier la fiche et associer la vidéo" })).toBeDisabled();
  expect(publishBodies).toHaveLength(0);
});

test("un numéro de saison incorrect bloque la publication dans l’interface", async ({ page }) => {
  const { publishBodies } = await setupRoutes(page, {
    episodeCount: 3,
    season: seasonPayload([tmdbEpisode(1), tmdbEpisode(2), tmdbEpisode(3)], 2),
  });
  const panel = await openBunnyPanel(page);

  await expect(panel.locator(".bunny-season-notice")).toContainText("Publication bloquée");
  await expect(panel.locator(".bunny-season-notice")).toContainText("ne correspond pas");
  await expect(panel.getByRole("button", { name: "Publier la fiche et associer la vidéo" })).toBeDisabled();
  expect(publishBodies).toHaveLength(0);
});

test("une erreur TMDB de saison ne déclenche aucune publication", async ({ page }) => {
  const { publishBodies } = await setupRoutes(page, {
    episodeCount: 3,
    season: seasonPayload([tmdbEpisode(1), tmdbEpisode(2), tmdbEpisode(3)]),
    seasonStatus: 500,
    seasonError: "TMDB indisponible pour cette saison.",
  });
  const panel = await openBunnyPanel(page);

  await expect(panel.getByText("TMDB indisponible pour cette saison.")).toBeVisible();
  await expect(panel.locator(".bunny-season-notice")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Publier la fiche et associer la vidéo" })).toBeDisabled();
  expect(publishBodies).toHaveLength(0);
});
