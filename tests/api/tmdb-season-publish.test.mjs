import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/catalog/publish.ts";
import {
  assessTmdbSeason,
  buildSeasonPublishFragment,
  planSeasonPublication,
} from "../../lib/cinebox/tmdb-season.mjs";
import { ADMIN_ENV, adminHeaders } from "./helpers/admin-auth.mjs";
import { createPublishD1 } from "./helpers/publish-d1.mjs";
import { installFetch } from "./helpers/fake-d1.mjs";

const VIDEO_ID = "0123456789abcdef0123456789abcdef";
const SERIES_ID = "tmdb:series:42";

function makeEnv(options = {}) {
  const db = createPublishD1(options);
  const env = { ...ADMIN_ENV, DB: db };
  return { env, calls: db.calls, reads: db.reads, state: db.state, batches: db.batches };
}

function request(body) {
  return new Request("https://cinebox.test/api/catalog/publish", {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders() },
    body: JSON.stringify(body),
  });
}

function seedSeries() {
  const titles = [{ id: SERIES_ID, kind: "series", title: "Série", metadata_json: "{}", published: 1 }];
  const episodes = [];
  for (const number of [1, 2, 3]) {
    episodes.push({
      id: `${SERIES_ID}:s1:e${number}`,
      title_id: SERIES_ID,
      season_number: 1,
      episode_number: number,
      title: `S1E${number}`,
      overview: "",
      duration_seconds: 2700,
      stream_uid: `bunny-1-${number}`,
      thumbnail_path: null,
      metadata_json: "{}",
    });
  }
  episodes.push({
    id: `${SERIES_ID}:s2:e1`,
    title_id: SERIES_ID,
    season_number: 2,
    episode_number: 1,
    title: "S2E1",
    overview: "",
    duration_seconds: 2700,
    stream_uid: "bunny-2-1",
    thumbnail_path: null,
    metadata_json: "{}",
  });
  return { titles, episodes };
}

function tmdbEpisode(number, id = 1000 + number) {
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

function tmdbSeason(seasonNumber, episodes) {
  return {
    season_number: seasonNumber,
    name: `Saison ${seasonNumber}`,
    overview: "Synopsis",
    air_date: "2020-01-01",
    episodes,
  };
}

function preparePublication({ season, seasonNumber = 1, episodeNumber = 2, referenceEpisodeCount, confirmed = false }) {
  const assessment = assessTmdbSeason({ season, requestedSeasonNumber: seasonNumber, referenceEpisodeCount });
  const plan = planSeasonPublication({ assessment, confirmed });
  const fragment = buildSeasonPublishFragment({ season, seasonNumber, episodeNumber, replaceSeason: plan.replaceSeason });
  return {
    assessment,
    plan,
    body: {
      tmdbId: 42,
      kind: "series",
      title: "Série",
      bunnyVideoId: VIDEO_ID,
      ...fragment,
    },
  };
}

test("une saison vérifiée et confirmée remplace uniquement sa saison et conserve stream_uid", async () => {
  const { env, state, batches } = makeEnv(seedSeries());
  const { assessment, plan, body } = preparePublication({
    season: tmdbSeason(1, [tmdbEpisode(1), tmdbEpisode(2)]),
    referenceEpisodeCount: 2,
    confirmed: true,
  });
  assert.equal(assessment.complete, true);
  assert.equal(plan.action, "replace");
  assert.equal(body.replaceSeason, true);

  const response = await onRequestPost({ request: request(body), env });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, "replaceSeason");
  assert.equal(result.episodesPublished, 2);
  assert.equal(result.episodesDeleted, 1);

  assert.deepEqual(state.episodes.map((episode) => episode.id).sort(), [
    `${SERIES_ID}:s1:e1`,
    `${SERIES_ID}:s1:e2`,
    `${SERIES_ID}:s2:e1`,
  ]);
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s1:e1`).stream_uid, "bunny-1-1");
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s1:e2`).stream_uid, VIDEO_ID);
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s2:e1`).stream_uid, "bunny-2-1");

  const deletes = batches[0].filter((statement) => statement.sql.startsWith("DELETE"));
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].values, [SERIES_ID, 1, `${SERIES_ID}:s1:e3`]);
});

test("une saison incomplète est publiée en upsert et conserve les épisodes absents", async () => {
  const { env, state, batches } = makeEnv(seedSeries());
  const { assessment, plan, body } = preparePublication({
    season: tmdbSeason(1, [tmdbEpisode(1), tmdbEpisode(2)]),
    referenceEpisodeCount: 3,
    confirmed: true,
  });
  assert.equal(assessment.reason, "count-mismatch");
  assert.equal(plan.action, "upsert");
  assert.equal(body.replaceSeason, false);

  const response = await onRequestPost({ request: request(body), env });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, "upsert");
  assert.equal(result.episodesPublished, 2);
  assert.equal(result.episodesDeleted, 0);

  assert.equal(state.episodes.length, 4);
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s1:e3`).stream_uid, "bunny-1-3");
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s1:e1`).stream_uid, "bunny-1-1");
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s1:e2`).stream_uid, VIDEO_ID);
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s2:e1`).stream_uid, "bunny-2-1");
  assert.equal(batches[0].some((statement) => statement.sql.startsWith("DELETE")), false);
});

test("une saison vide ne supprime aucune ligne D1", async () => {
  const { env, state, batches } = makeEnv(seedSeries());
  const { assessment, plan, body } = preparePublication({
    season: tmdbSeason(1, []),
    referenceEpisodeCount: 0,
    episodeNumber: 1,
    confirmed: true,
  });
  assert.equal(assessment.reason, "empty");
  assert.equal(plan.action, "upsert");
  assert.equal(body.replaceSeason, false);

  const response = await onRequestPost({ request: request(body), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
  assert.equal(state.episodes.length, 4);
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s1:e3`).stream_uid, "bunny-1-3");
});

test("l’absence de compteur fiable reste un upsert même après confirmation", async () => {
  const { env, state } = makeEnv(seedSeries());
  const { assessment, plan, body } = preparePublication({
    season: tmdbSeason(1, [tmdbEpisode(1), tmdbEpisode(2)]),
    referenceEpisodeCount: null,
    confirmed: true,
  });
  assert.equal(assessment.reason, "missing-reference-count");
  assert.equal(plan.action, "upsert");
  assert.equal(body.replaceSeason, false);

  const response = await onRequestPost({ request: request(body), env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, "upsert");
  assert.equal(state.episodes.length, 4);
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s1:e3`).stream_uid, "bunny-1-3");
});

test("une saison bloquée n’est jamais envoyée et un payload strict incohérent est refusé", async () => {
  const { env, state, batches } = makeEnv(seedSeries());
  const duplicateSeason = tmdbSeason(1, [tmdbEpisode(1), tmdbEpisode(1, 2002)]);
  const assessment = assessTmdbSeason({ season: duplicateSeason, requestedSeasonNumber: 1, referenceEpisodeCount: 2 });
  const plan = planSeasonPublication({ assessment, confirmed: true });
  assert.equal(assessment.blocking, true);
  assert.equal(plan.action, "blocked");
  assert.equal(plan.replaceSeason, false);

  // Even a malicious client forcing replaceSeason: true cannot get a duplicate
  // strict snapshot through the server, and D1 stays untouched.
  const response = await onRequestPost({
    request: request({
      tmdbId: 42,
      kind: "series",
      title: "Série",
      replaceSeason: true,
      targetEpisode: { seasonNumber: 1, episodeNumber: 1 },
      seasons: [{
        number: 1,
        episodes: [
          { number: 1, title: "E1" },
          { number: 1, title: "E1 bis" },
        ],
      }],
    }),
    env,
  });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
  assert.equal(state.episodes.length, 4);
  assert.equal(state.episodes.find((episode) => episode.id === `${SERIES_ID}:s1:e3`).stream_uid, "bunny-1-3");
});

test("un numéro de saison incorrect bloque avant tout appel de publication", async () => {
  const { env, state, batches } = makeEnv(seedSeries());
  const assessment = assessTmdbSeason({
    season: tmdbSeason(2, [tmdbEpisode(1), tmdbEpisode(2)]),
    requestedSeasonNumber: 1,
    referenceEpisodeCount: 2,
  });
  const plan = planSeasonPublication({ assessment, confirmed: true });
  assert.equal(assessment.reason, "season-mismatch");
  assert.equal(plan.action, "blocked");
  assert.equal(plan.replaceSeason, false);
  assert.equal(batches.length, 0);
  assert.equal(state.episodes.length, 4);
});

test("le remplacement et l’upsert ne contactent jamais l’API Bunny", async () => {
  const { env } = makeEnv(seedSeries());
  const bunny = installFetch(() => {
    throw new Error("Bunny must not be called during season publication");
  });
  try {
    const complete = preparePublication({
      season: tmdbSeason(1, [tmdbEpisode(1), tmdbEpisode(2)]),
      referenceEpisodeCount: 2,
      confirmed: true,
    });
    const first = await onRequestPost({ request: request(complete.body), env });
    assert.equal(first.status, 200);

    const incomplete = preparePublication({
      season: tmdbSeason(1, [tmdbEpisode(1), tmdbEpisode(2)]),
      referenceEpisodeCount: 3,
      confirmed: true,
    });
    const second = await onRequestPost({ request: request(incomplete.body), env });
    assert.equal(second.status, 200);

    assert.equal(bunny.calls.length, 0);
  } finally {
    bunny.restore();
  }
});
