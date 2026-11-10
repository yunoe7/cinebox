import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/catalog/publish.ts";
import { ADMIN_ENV, adminHeaders } from "./helpers/admin-auth.mjs";

function makeEnv() {
  const calls = [];
  const env = {
    ...ADMIN_ENV,
    DB: {
      prepare(sql) {
        const call = { sql, values: [] };
        calls.push(call);
        return { bind(...values) { call.values = values; return this; } };
      },
      async batch(statements) {
        return statements.map(() => ({ success: true }));
      },
    },
  };
  return { env, calls };
}
function request(body, { authenticated = true, extra = {} } = {}) {
  return new Request("https://cinebox.test/api/catalog/publish", {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders({ authenticated, extra }) },
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

test("shared publishing reports a server configuration error without admin secrets", async () => {
  const { env, calls } = makeEnv();
  env.CINEBOX_ADMIN_PASSWORD_HASH = undefined;
  const response = await onRequestPost({ request: request({ tmdbId: 1, kind: "movie", title: "Film" }), env });
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
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
  assert.deepEqual(await response.json(), { published: true, id: "tmdb:series:42", kind: "series", episodesPublished: 1 });
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

test("republishing merges metadata instead of overwriting Bunny and TMDB fields", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "movie", title: "Film", bunnyVideoId: "0123456789abcdef0123456789abcdef",
    metadata: { voteAverage: 7.5 },
  }), env });
  assert.equal(response.status, 200);
  assert.match(calls[0].sql, /json_patch\(CASE WHEN json_valid\(metadata_json\)/);
  assert.match(calls[0].sql, /excluded\.metadata_json/);
  const metadata = JSON.parse(calls[0].values[8]);
  assert.equal(metadata.bunnyVideoId, "0123456789abcdef0123456789abcdef");
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

test("publishing a Bunny video rejects a target episode absent from the payload", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", bunnyVideoId: "0123456789abcdef0123456789abcdef",
    targetEpisode: { seasonNumber: 1, episodeNumber: 9 },
    seasons: [{ number: 1, episodes: [{ number: 1, title: "Épisode 1" }] }],
  }), env });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("publishing a Bunny video associates the existing target episode", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({
    tmdbId: 42, kind: "series", title: "Série", bunnyVideoId: "0123456789abcdef0123456789abcdef",
    targetEpisode: { seasonNumber: 1, episodeNumber: 2 },
    seasons: [{ number: 1, episodes: [{ number: 2, title: "Épisode 2" }] }],
  }), env });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
  assert.match(calls[2].sql, /UPDATE catalog_episodes SET stream_uid/);
  assert.deepEqual(calls[2].values, [
    "0123456789abcdef0123456789abcdef",
    "tmdb:series:42:s1:e2",
    "tmdb:series:42",
  ]);
});
