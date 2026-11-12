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
  assert.match(calls[0].sql, /published=1/);
  assert.match(calls[0].values[0], /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(calls[0].values.slice(1), ["movie", 10, 5]);
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
      vipExclusive: false,
      vipEarlyAccess: false,
      access: "public",
      seasons: [],
      updatedAt: "2026-11-07 12:00:00",
    }],
    stats: { titles: 0, films: 0, series: 0, videos: 0, episodes: 0 },
    pagination: { limit: 10, offset: 5, count: 1 },
    viewer: { authenticated: false, vip: false },
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

function makeCatalogEnv({ rows = [], episodes = [] } = {}) {
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        const call = { sql, values: [] };
        calls.push(call);
        return {
          bind(...values) { call.values = values; return this; },
          async all() {
            if (/COUNT\(\*\) AS titles/.test(sql)) {
              return { success: true, results: [{ titles: rows.length, films: rows.length, series: 0, videos: 0 }] };
            }
            if (/COUNT\(\*\) AS episodes/.test(sql)) {
              return { success: true, results: [{ episodes: episodes.length }] };
            }
            if (/FROM catalog_episodes/.test(sql)) {
              return { success: true, results: episodes };
            }
            return { success: true, results: rows };
          },
        };
      },
    },
  };
  return { env, calls };
}

const ageRows = [
  {
    id: "tmdb:movie:1", kind: "movie", title: "Tous publics", overview: "",
    release_date: "2020-01-01", poster_path: null, backdrop_path: null,
    genres_json: "[]", metadata_json: '{"ageRating":"TP","minAge":0}', updated_at: "now",
  },
  {
    id: "tmdb:series:2", kind: "series", title: "Série 10+", overview: "",
    release_date: "2020-01-01", poster_path: null, backdrop_path: null,
    genres_json: "[]", metadata_json: '{"minAge":10}', updated_at: "now",
  },
  {
    id: "tmdb:movie:3", kind: "movie", title: "Film 12", overview: "",
    release_date: "2020-01-01", poster_path: null, backdrop_path: null,
    genres_json: "[]", metadata_json: '{"ageRating":"12"}', updated_at: "now",
  },
  {
    id: "tmdb:movie:4", kind: "movie", title: "Non classé", overview: "",
    release_date: "2020-01-01", poster_path: null, backdrop_path: null,
    genres_json: "[]", metadata_json: "{}", updated_at: "now",
  },
  {
    id: "tmdb:movie:5", kind: "movie", title: "Adulte", overview: "",
    release_date: "2020-01-01", poster_path: null, backdrop_path: null,
    genres_json: "[]", metadata_json: '{"adult":true}', updated_at: "now",
  },
];

test("catalogue maxAge excludes unclassified and over-age titles (fail closed)", async () => {
  const { env, calls } = makeCatalogEnv({ rows: ageRows });
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog?maxAge=10"),
    env,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.titles.map((title) => title.title), ["Tous publics", "Série 10+"]);
  assert.equal(body.pagination.count, 2);
  assert.match(calls[0].values[0], /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(calls[0].values.slice(1), [500, 0]);
});

test("catalogue maxAge keeps exact pagination after filtering", async () => {
  const { env } = makeCatalogEnv({ rows: ageRows });
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog?maxAge=10&limit=1&offset=1"),
    env,
  });
  const body = await response.json();
  assert.deepEqual(body.titles.map((title) => title.title), ["Série 10+"]);
  assert.deepEqual(body.pagination, { limit: 1, offset: 1, count: 1 });
});

test("catalogue maxAge rejects invalid values", async () => {
  for (const value of ["-1", "19", "abc", "10.5"]) {
    const { env, calls } = makeCatalogEnv({ rows: ageRows });
    const response = await onRequestGet({
      request: new Request(`https://cinebox.test/api/catalog?maxAge=${value}`),
      env,
    });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  }
});

test("catalogue without maxAge returns unclassified titles", async () => {
  const { env } = makeCatalogEnv({ rows: ageRows });
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog"),
    env,
  });
  const body = await response.json();
  assert.equal(body.titles.length, ageRows.length);
});
