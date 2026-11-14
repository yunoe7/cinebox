import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/catalog/publish.ts";
import { ADMIN_ENV, discordAdminHeaders, withDiscordAdminDb } from "./helpers/admin-auth.mjs";
import { createPublishD1 } from "./helpers/publish-d1.mjs";

function makeEnv(options = {}) {
  const db = createPublishD1(options);
  const env = { ...ADMIN_ENV, DB: withDiscordAdminDb(db) };
  return { env, calls: db.calls, reads: db.reads, state: db.state, batches: db.batches };
}

function seedSeries({ id = "tmdb:series:42", seasons = [1, 2] } = {}) {
  const titles = [{ id, kind: "series", title: "Série", metadata_json: "{}", published: 1 }];
  const episodes = [];
  for (const seasonNumber of seasons) {
    for (const episodeNumber of [1, 2]) {
      episodes.push({
        id: `${id}:s${seasonNumber}:e${episodeNumber}`,
        title_id: id,
        season_number: seasonNumber,
        episode_number: episodeNumber,
        title: `S${seasonNumber}E${episodeNumber}`,
        overview: "",
        duration_seconds: 2700,
        stream_uid: `legacy-${seasonNumber}-${episodeNumber}`,
        thumbnail_path: null,
        metadata_json: "{}",
      });
    }
  }
  return { titles, episodes };
}
function request(body, { authenticated = true, extra = {} } = {}) {
  return new Request("https://cinebox.test/api/catalog/publish", {
    method: "POST",
    headers: { "content-type": "application/json", ...discordAdminHeaders({ authenticated, extra }) },
    body: JSON.stringify(body),
  });
}

test("shared publishing rejects unauthenticated requests", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({ tmdbId: 1, kind: "movie", title: "Film" }, { authenticated: false }), env });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("shared publishing rejects a legacy Bearer token", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({
    request: request({ tmdbId: 1, kind: "movie", title: "Film" }, {
      authenticated: false,
      extra: { authorization: "Bearer test-admin-token-that-is-long-enough-for-testing-123" },
    }),
    env,
  });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("shared publishing does not require a separate admin password", async () => {
  const { env, calls } = makeEnv();
  env.CINEBOX_ADMIN_PASSWORD_HASH = undefined;
  env.CINEBOX_SESSION_SECRET = undefined;
  const response = await onRequestPost({ request: request({ tmdbId: 1, kind: "movie", title: "Film" }), env });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test("shared publishing validates input before writing", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({ tmdbId: -1, kind: "movie", title: "" }), env });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("shared publishing upserts TMDB title and its episodes in one batch", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série test", overview: "Résumé",
    posterPath: "/poster.jpg", backdropPath: "/backdrop.jpg", genres: ["Drame"],
    seasons: [{ number: 1, episodes: [{ number: 2, title: "Épisode 2", runtime: 45, thumbnailPath: "/still.jpg" }] }],
  }), env });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /INSERT INTO catalog_titles/);
  assert.match(calls[0].sql, /published, updated_at/);
  assert.match(calls[1].sql, /INSERT INTO catalog_episodes/);
  assert.deepEqual(await response.json(), {
    published: true,
    id: "tmdb:series:42",
    kind: "series",
    mode: "upsert",
    episodesPublished: 1,
    episodesDeleted: 0,
  });
});

test("a film and a series with the same TMDB id are published under distinct ids", async () => {
  const { env, calls } = makeEnv();
  const movie = await onRequestPost({ request: request({ tmdbId: 42, kind: "movie", title: "Film" }), env });
  const series = await onRequestPost({ request: request({ tmdbId: 42, kind: "series", title: "Série" }), env });
  assert.equal((await movie.json()).id, "tmdb:movie:42");
  assert.equal((await series.json()).id, "tmdb:series:42");
  assert.deepEqual(calls.map(call => call.values[0]), ["tmdb:movie:42", "tmdb:series:42"]);
});

test("editing and republishing a TMDB title updates the same shared id", async () => {
  const { env, calls } = makeEnv();
  const first = await onRequestPost({ request: request({ tmdbId: 42, kind: "series", title: "Titre initial" }), env });
  const second = await onRequestPost({ request: request({ tmdbId: 42, kind: "series", title: "Titre modifié" }), env });
  assert.equal((await first.json()).id, "tmdb:series:42");
  assert.equal((await second.json()).id, "tmdb:series:42");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.values[0]), ["tmdb:series:42", "tmdb:series:42"]);
  assert.equal(calls[1].values[2], "Titre modifié");
  assert.match(calls[1].sql, /ON CONFLICT\(id\) DO UPDATE/);
});

test("publishing rejects an id whose kind does not match the title kind", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    id: "tmdb:movie:42", tmdbId: 42, kind: "series", title: "Incohérent",
  }), env });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("publishing rejects a TMDB id that disagrees with the shared id", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    id: "tmdb:movie:42", tmdbId: 43, kind: "movie", title: "Incohérent",
  }), env });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("republishing merges metadata instead of overwriting TMDB fields", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "movie", title: "Film",
    metadata: { voteAverage: 7.5 },
  }), env });
  assert.equal(response.status, 200);
  assert.match(calls[0].sql, /json_patch\(CASE WHEN json_valid\(metadata_json\)/);
  assert.match(calls[0].sql, /excluded\.metadata_json/);
  const metadata = JSON.parse(calls[0].values[8]);
  assert.equal(metadata.tmdbId, 42);
});

test("an explicit cinebox id is preserved when TMDB metadata is added later", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    id: "cinebox:1700000000000", tmdbId: 42, kind: "movie", title: "Titre local",
  }), env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, "cinebox:1700000000000");
  assert.equal(calls[0].values[0], "cinebox:1700000000000");
  assert.equal(JSON.parse(calls[0].values[8]).tmdbId, 42);
});

test("publishing a video for a series ignores a legacy target episode", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série",
    targetEpisode: { seasonNumber: 1, episodeNumber: 2 },
    seasons: [{ number: 1, episodes: [{ number: 2, title: "Épisode 2" }] }],
  }), env });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /INSERT INTO catalog_titles/);
  assert.match(calls[1].sql, /INSERT INTO catalog_episodes/);
});

test("the local editor aliases are normalized to canonical metadata", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    id: "cinebox:1700000000000", kind: "movie", title: "Film local",
    metadata: {
      originalName: "Nom original", originalLanguage: "fr", productionCountries: ["France"],
      cast: ["Acteur A"], director: "Jane Doe", rating: 8.2, voteCount: 42,
      collection: "Saga", duration: "1 h 45", ageRating: "12", minAge: 12, adult: false,
    },
  }), env });
  assert.equal(response.status, 200);
  const metadata = JSON.parse(calls[0].values[8]);
  assert.equal(metadata.voteAverage, 8.2);
  assert.deepEqual(metadata.directors, ["Jane Doe"]);
  assert.equal(metadata.runtime, 105);
  assert.equal(metadata.duration, "1 h 45");
  assert.equal(metadata.rating, undefined);
  assert.equal(metadata.director, undefined);
  assert.equal(metadata.originalName, "Nom original");
  assert.deepEqual(metadata.productionCountries, ["France"]);
  assert.equal(metadata.ageRating, "12");
});

test("the canonical TMDB metadata is preserved", async () => {
  const { env, calls } = makeEnv();
  const reviews = [{ author: "Critique", content: "Bien", rating: 8, createdAt: "2024-01-01" }];
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "movie", title: "Film TMDB",
    metadata: {
      voteAverage: 7.5, voteCount: 900, runtime: 120, originalLanguage: "en",
      cast: [{ name: "Acteur A", character: "Rôle" }],
      directors: ["John Smith"],
      tmdbReviews: reviews,
    },
  }), env });
  assert.equal(response.status, 200);
  const metadata = JSON.parse(calls[0].values[8]);
  assert.equal(metadata.voteAverage, 7.5);
  assert.equal(metadata.voteCount, 900);
  assert.equal(metadata.runtime, 120);
  assert.equal(metadata.duration, undefined);
  assert.deepEqual(metadata.directors, ["John Smith"]);
  assert.deepEqual(metadata.tmdbReviews, reviews);
  assert.equal(metadata.tmdbId, 42);
});

test("both publishing paths produce the same canonical values", async () => {
  const local = makeEnv();
  await onRequestPost({ request: request({
    id: "cinebox:1700000000001", kind: "movie", title: "Film local",
    metadata: { rating: 8.4, director: "Same Director", duration: "2 h 05" },
  }), env: local.env });

  const remote = makeEnv();
  await onRequestPost({ request: request({
    tmdbId: 7, kind: "movie", title: "Film TMDB",
    metadata: { voteAverage: 8.4, directors: ["Same Director"], runtime: 125 },
  }), env: remote.env });

  const localMetadata = JSON.parse(local.calls[0].values[8]);
  const remoteMetadata = JSON.parse(remote.calls[0].values[8]);
  assert.equal(localMetadata.voteAverage, remoteMetadata.voteAverage);
  assert.deepEqual(localMetadata.directors, remoteMetadata.directors);
  assert.equal(localMetadata.runtime, remoteMetadata.runtime);
});

test("a numeric duration becomes runtime minutes", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    id: "cinebox:1700000000002", kind: "movie", title: "Durée",
    metadata: { duration: 95 },
  }), env });
  assert.equal(response.status, 200);
  const metadata = JSON.parse(calls[0].values[8]);
  assert.equal(metadata.runtime, 95);
  assert.equal(metadata.duration, "95 min");
});

test("empty or invalid values are omitted so json_patch keeps existing data", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    id: "cinebox:1700000000003", kind: "movie", title: "Vide",
    metadata: {
      voteAverage: null, rating: "", directors: [], director: "   ",
      runtime: null, duration: "",
    },
  }), env });
  assert.equal(response.status, 200);
  assert.match(calls[0].sql, /json_patch/);
  const patch = JSON.parse(calls[0].values[8]);
  for (const key of ["voteAverage", "rating", "directors", "director", "runtime", "duration"]) {
    assert.equal(Object.hasOwn(patch, key), false, key);
  }
  const existing = { voteAverage: 7.5, directors: ["Ancien"], runtime: 120, duration: "120 min" };
  assert.deepEqual({ ...existing, ...patch }, existing);
});

test("local republishing does not send or erase TMDB fields", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    id: "cinebox:1700000000004", kind: "movie", title: "Reprise locale",
    metadata: { rating: 7, director: "Local Director", duration: "100 min" },
  }), env });
  assert.equal(response.status, 200);
  const patch = JSON.parse(calls[0].values[8]);
  for (const key of ["tmdbReviews", "stream_uid", "tmdbId"]) {
    assert.equal(Object.hasOwn(patch, key), false, key);
  }
  const existing = {
    tmdbReviews: [{ author: "Critique", content: "Bien" }],
    tmdbId: 42,
  };
  assert.deepEqual({ ...existing, ...patch }, {
    ...existing,
    voteAverage: 7,
    directors: ["Local Director"],
    runtime: 100,
    duration: "100 min",
  });
});

test("publishing the same metadata twice is idempotent", async () => {
  const { env, calls } = makeEnv();
  const body = {
    id: "cinebox:1700000000005", kind: "movie", title: "Idempotent",
    metadata: { rating: 8, director: "A", duration: "1 h 30" },
  };
  await onRequestPost({ request: request(body), env });
  await onRequestPost({ request: request(body), env });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].values[8]), JSON.parse(calls[1].values[8]));
});

test("a publication without a replacement indicator never deletes episodes", async () => {
  const { env, state, batches } = makeEnv(seedSeries());
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série",
    seasons: [{ number: 1, episodes: [{ number: 1, title: "S1E1" }] }],
  }), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "upsert");
  assert.equal(body.episodesDeleted, 0);
  assert.equal(state.episodes.length, 4);
  assert.equal(batches.length, 1);
  assert.equal(state.episodes.find((episode) => episode.id === "tmdb:series:42:s1:e2").stream_uid, "legacy-1-2");
});

test("replaceSeason deletes only the absent episodes of the targeted season", async () => {
  const { env, state } = makeEnv(seedSeries());
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", replaceSeason: true,
    seasons: [{ number: 1, episodes: [
      { number: 1, title: "S1E1" },
      { number: 3, title: "S1E3" },
    ] }],
  }), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "replaceSeason");
  assert.equal(body.episodesPublished, 2);
  assert.equal(body.episodesDeleted, 1);
  assert.deepEqual(state.episodes.map((episode) => episode.id).sort(), [
    "tmdb:series:42:s1:e1",
    "tmdb:series:42:s1:e3",
    "tmdb:series:42:s2:e1",
    "tmdb:series:42:s2:e2",
  ]);
  assert.equal(state.episodes.find((episode) => episode.id === "tmdb:series:42:s1:e1").stream_uid, "legacy-1-1");
  assert.equal(state.episodes.find((episode) => episode.id === "tmdb:series:42:s1:e3").stream_uid, null);
  assert.equal(state.episodes.find((episode) => episode.id === "tmdb:series:42:s2:e1").stream_uid, "legacy-2-1");
});

test("replaceTitle deletes every episode absent from the full snapshot", async () => {
  const { env, state } = makeEnv(seedSeries());
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", replaceTitle: true,
    seasons: [{ number: 1, episodes: [{ number: 1, title: "S1E1" }] }],
  }), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "replaceTitle");
  assert.equal(body.episodesPublished, 1);
  assert.equal(body.episodesDeleted, 3);
  assert.deepEqual(state.episodes.map((episode) => episode.id), ["tmdb:series:42:s1:e1"]);
  assert.equal(state.episodes[0].stream_uid, "legacy-1-1");
});

test("empty replacement snapshots are refused without writes", async () => {
  const { env, state, batches } = makeEnv(seedSeries());
  const bodies = [
    { tmdbId: 42, kind: "series", title: "Série", replaceSeason: true, seasons: [{ number: 1, episodes: [] }] },
    { tmdbId: 42, kind: "series", title: "Série", replaceTitle: true, seasons: [] },
    { tmdbId: 42, kind: "series", title: "Série", replaceTitle: true, seasons: [{ number: 1, episodes: [] }] },
  ];
  for (const body of bodies) {
    const response = await onRequestPost({ request: request(body), env });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(batches.length, 0);
  assert.equal(state.episodes.length, 4);
});

test("replaceSeason and replaceTitle are mutually exclusive", async () => {
  const { env, batches } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", replaceSeason: true, replaceTitle: true,
    seasons: [{ number: 1, episodes: [{ number: 1, title: "E1" }] }],
  }), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
});

test("replaceSeason requires exactly one season", async () => {
  const { env, batches } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", replaceSeason: true,
    seasons: [
      { number: 1, episodes: [{ number: 1, title: "E1" }] },
      { number: 2, episodes: [{ number: 1, title: "E1" }] },
    ],
  }), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
});

const LOCAL_ID = "cinebox:1700000000009";

test("changing a series to a movie without replaceTitle is rejected without writes", async () => {
  const { env, state, batches } = makeEnv({
    titles: [{ id: LOCAL_ID, kind: "series", title: "Série", metadata_json: "{}", published: 1 }],
    episodes: [{
      id: `${LOCAL_ID}:s1:e1`,
      title_id: LOCAL_ID,
      season_number: 1,
      episode_number: 1,
      title: "E1",
      overview: "",
      duration_seconds: 2700,
      stream_uid: "legacy-episode",
      thumbnail_path: null,
      metadata_json: "{}",
    }],
  });
  const response = await onRequestPost({ request: request({
    id: LOCAL_ID, kind: "movie", title: "Film",
  }), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
  assert.equal(state.titles[0].kind, "series");
  assert.equal(state.episodes.length, 1);
  assert.equal(state.episodes[0].stream_uid, "legacy-episode");
});

test("changing a series to a movie with replaceTitle deletes its episodes atomically", async () => {
  const { env, state } = makeEnv({
    titles: [{ id: LOCAL_ID, kind: "series", title: "Série", metadata_json: "{}", published: 1 }],
    episodes: [1, 2].map((number) => ({
      id: `${LOCAL_ID}:s1:e${number}`,
      title_id: LOCAL_ID,
      season_number: 1,
      episode_number: number,
      title: `E${number}`,
      overview: "",
      duration_seconds: 2700,
      stream_uid: "legacy-episode",
      thumbnail_path: null,
      metadata_json: "{}",
    })),
  });
  const response = await onRequestPost({ request: request({
    id: LOCAL_ID, kind: "movie", title: "Film", replaceTitle: true,
    metadata: { runtime: 120 },
  }), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "replaceTitle");
  assert.equal(body.episodesPublished, 0);
  assert.equal(body.episodesDeleted, 2);
  assert.equal(state.titles[0].kind, "movie");
  assert.equal(state.episodes.length, 0);
});

test("a series-to-movie replacement refuses a season payload", async () => {
  const { env, state, batches } = makeEnv({
    titles: [{ id: LOCAL_ID, kind: "series", title: "Série", metadata_json: "{}", published: 1 }],
    episodes: [],
  });
  const response = await onRequestPost({ request: request({
    id: LOCAL_ID, kind: "movie", title: "Film", replaceTitle: true,
    seasons: [{ number: 1, episodes: [{ number: 1, title: "E1" }] }],
  }), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
  assert.equal(state.titles[0].kind, "series");
});

test("an invalid replacement payload writes nothing", async () => {
  const { env, state, batches } = makeEnv(seedSeries());
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", replaceSeason: true,
    seasons: [{ number: 1, episodes: [
      { number: 1, title: "E1" },
      { number: "2", title: "E2" },
    ] }],
  }), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
  assert.equal(state.episodes.length, 4);
});

test("a D1 batch failure leaves the catalogue unchanged", async () => {
  const { env, state } = makeEnv({ ...seedSeries(), failOnSql: "INSERT INTO catalog_episodes" });
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série modifiée", replaceSeason: true,
    seasons: [{ number: 1, episodes: [{ number: 1, title: "S1E1" }] }],
  }), env });
  assert.equal(response.status, 503);
  assert.equal(state.titles[0].title, "Série");
  assert.equal(state.episodes.length, 4);
  assert.equal(state.episodes.find((episode) => episode.id === "tmdb:series:42:s1:e2").stream_uid, "legacy-1-2");
});

test("a publication above the episode cap is rejected", async () => {
  const { env, batches } = makeEnv();
  const episodes = Array.from({ length: 501 }, (_, index) => ({ number: index + 1, title: `E${index + 1}` }));
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", replaceSeason: true,
    seasons: [{ number: 1, episodes }],
  }), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
});

test("a reconciliation above the deletion cap is rejected without writes", async () => {
  const id = "tmdb:series:42";
  const titles = [{ id, kind: "series", title: "Série", metadata_json: "{}", published: 1 }];
  const episodes = Array.from({ length: 1002 }, (_, index) => ({
    id: `${id}:s1:e${index + 1}`,
    title_id: id,
    season_number: 1,
    episode_number: index + 1,
    title: `S1E${index + 1}`,
    overview: "",
    duration_seconds: 2700,
    stream_uid: `legacy-1-${index + 1}`,
    thumbnail_path: null,
    metadata_json: "{}",
  }));
  const { env, state, batches } = makeEnv({ titles, episodes });
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", replaceSeason: true,
    seasons: [{ number: 1, episodes: [{ number: 1, title: "S1E1" }] }],
  }), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
  assert.equal(state.episodes.length, 1002);
  assert.equal(state.episodes.find((episode) => episode.id === `${id}:s1:e2`).stream_uid, "legacy-1-2");
});

test("replaceSeason deletes only the obsolete episode and keeps every retained row", async () => {
  const id = "tmdb:series:42";
  const titles = [{ id, kind: "series", title: "Série", metadata_json: "{}", published: 1 }];
  const episodes = [];
  for (let number = 1; number <= 121; number += 1) {
    episodes.push({
      id: `${id}:s1:e${number}`,
      title_id: id,
      season_number: 1,
      episode_number: number,
      title: `S1E${number}`,
      overview: "",
      duration_seconds: 2700,
      stream_uid: `legacy-1-${number}`,
      thumbnail_path: null,
      metadata_json: "{}",
    });
  }
  for (const number of [1, 2]) {
    episodes.push({
      id: `${id}:s2:e${number}`,
      title_id: id,
      season_number: 2,
      episode_number: number,
      title: `S2E${number}`,
      overview: "",
      duration_seconds: 2700,
      stream_uid: `legacy-2-${number}`,
      thumbnail_path: null,
      metadata_json: "{}",
    });
  }
  const { env, state, batches } = makeEnv({ titles, episodes });
  const payloadEpisodes = Array.from({ length: 120 }, (_, index) => ({ number: index + 1, title: `S1E${index + 1}` }));
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", replaceSeason: true,
    seasons: [{ number: 1, episodes: payloadEpisodes }],
  }), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "replaceSeason");
  assert.equal(body.episodesPublished, 120);
  assert.equal(body.episodesDeleted, 1);

  const deletes = batches[0].filter((statement) => statement.sql.startsWith("DELETE"));
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].values, [id, 1, `${id}:s1:e121`]);

  const ids = state.episodes.map((episode) => episode.id);
  assert.equal(ids.includes(`${id}:s1:e121`), false);
  for (let number = 1; number <= 120; number += 1) {
    assert.equal(ids.includes(`${id}:s1:e${number}`), true, `episode ${number} must survive`);
  }
  assert.equal(ids.includes(`${id}:s2:e1`), true);
  assert.equal(ids.includes(`${id}:s2:e2`), true);
  assert.equal(state.episodes.find((episode) => episode.id === `${id}:s1:e1`).stream_uid, "legacy-1-1");
  assert.equal(state.episodes.find((episode) => episode.id === `${id}:s1:e120`).stream_uid, "legacy-1-120");
  assert.equal(state.episodes.find((episode) => episode.id === `${id}:s2:e2`).stream_uid, "legacy-2-2");
});

const FUTURE = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

test("publishing explicit VIP flags stores them in the same batch", async () => {
  const { env, calls, state } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "movie", title: "Film VIP",
    vipExclusive: true, vipEarlyAccess: false, publicAt: null,
  }), env });
  assert.equal(response.status, 200);
  assert.match(calls[0].sql, /vip_exclusive, vip_early_access, public_at/);
  assert.match(calls[0].sql, /vip_exclusive=excluded\.vip_exclusive/);
  const title = state.titles.find((entry) => entry.id === "tmdb:movie:42");
  assert.equal(title.vip_exclusive, 1);
  assert.equal(title.vip_early_access, 0);
  assert.equal(title.public_at, null);
});

test("publishing early access stores the mandatory public date", async () => {
  const { env, state } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "movie", title: "Film avant-première",
    vipExclusive: false, vipEarlyAccess: true, publicAt: FUTURE,
  }), env });
  assert.equal(response.status, 200);
  const title = state.titles.find((entry) => entry.id === "tmdb:movie:42");
  assert.equal(title.vip_early_access, 1);
  assert.equal(title.public_at, FUTURE);
});

test("a republish without VIP fields never resets the stored rights", async () => {
  const { env, state } = makeEnv({
    titles: [{
      id: "tmdb:movie:42", kind: "movie", title: "Film VIP", metadata_json: "{}", published: 1,
      vip_exclusive: 1, vip_early_access: 0, public_at: null,
    }],
  });
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "movie", title: "Film VIP modifié",
  }), env });
  assert.equal(response.status, 200);
  const title = state.titles.find((entry) => entry.id === "tmdb:movie:42");
  assert.equal(title.title, "Film VIP modifié");
  assert.equal(title.vip_exclusive, 1, "the exclusive flag must survive a plain republish");
});

test("publishing early access without a date is refused without writes", async () => {
  const { env, state, batches } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "movie", title: "Film", vipEarlyAccess: true, publicAt: null,
  }), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
  assert.equal(state.titles.length, 0);
});

test("publishing contradictory VIP flags is refused without writes", async () => {
  const { env, state, batches } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "movie", title: "Film",
    vipExclusive: true, vipEarlyAccess: true, publicAt: FUTURE,
  }), env });
  assert.equal(response.status, 400);
  assert.equal(batches.length, 0);
  assert.equal(state.titles.length, 0);
});
