import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/catalog/index.ts";

function makeEnv(rows = []) {
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        const call = { sql, values: [] };
        calls.push(call);
        return {
          bind(...values) { call.values = values; return this; },
          async all() { return { success: true, results: rows }; },
        };
      },
    },
  };
  return { env, calls };
}

test("catalogue rejects unsupported kinds", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog?kind=private"),
    env,
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("catalogue validates pagination bounds", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog?limit=100"),
    env,
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("catalogue returns only published titles and maps metadata safely", async () => {
  const { env, calls } = makeEnv([{
    id: "123",
    kind: "movie",
    title: "Film de test",
    overview: "Description",
    release_date: "2024-01-01",
    poster_path: "/poster.jpg",
    backdrop_path: null,
    genres_json: '["Drame"]',
    metadata_json: '{"rating":8}',
    updated_at: "2026-11-07 12:00:00",
  }]);
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog?kind=movie&limit=10&offset=5"),
    env,
  });
  assert.equal(response.status, 200);
  assert.match(calls[0].sql, /published = 1/);
  assert.deepEqual(calls[0].values, ["movie", 10, 5]);
  assert.deepEqual(await response.json(), {
    titles: [{
      id: "123",
      kind: "movie",
      title: "Film de test",
      overview: "Description",
      releaseDate: "2024-01-01",
      posterPath: "/poster.jpg",
      backdropPath: null,
      genres: ["Drame"],
      metadata: { rating: 8 },
      updatedAt: "2026-11-07 12:00:00",
    }],
    pagination: { limit: 10, offset: 5, count: 1 },
  });
});

test("catalogue handles malformed stored JSON without failing", async () => {
  const { env } = makeEnv([{
    id: "124", kind: "video", title: "Vidéo", overview: "",
    release_date: null, poster_path: null, backdrop_path: null,
    genres_json: "{", metadata_json: "[]", updated_at: "now",
  }]);
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog"),
    env,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.titles[0].genres, []);
  assert.deepEqual(body.titles[0].metadata, {});
});

test("catalogue returns 503 when D1 is unavailable", async () => {
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog"),
    env: {},
  });
  assert.equal(response.status, 503);
});
