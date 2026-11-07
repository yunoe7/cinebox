import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/catalog/publish.ts";

const TOKEN = "test-admin-token-that-is-long-enough-for-testing-123";

function makeEnv() {
  const calls = [];
  const env = {
    CINEBOX_ADMIN_TOKEN: TOKEN,
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
function request(body, token = TOKEN) {
  return new Request("https://cinebox.test/api/catalog/publish", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

test("shared publishing rejects unauthenticated requests", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request({ tmdbId: 1, kind: "movie", title: "Film" }, ""), env });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("shared publishing stays disabled without a server secret", async () => {
  const { env } = makeEnv();
  delete env.CINEBOX_ADMIN_TOKEN;
  const response = await onRequestPost({ request: request({ tmdbId: 1, kind: "movie", title: "Film" }), env });
  assert.equal(response.status, 503);
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
