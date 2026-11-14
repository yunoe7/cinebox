import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/catalog/index.ts";
import { ACCOUNT, catalogTitle, createCatalogD1 } from "./helpers/catalog-d1.mjs";

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
          async first() { return /INSERT INTO account_rate_limits/.test(sql) ? { attempts: 1 } : null; },
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
  const listingCall = calls.find((call) => /FROM catalog_titles/.test(call.sql) && call.sql.includes("ORDER BY"));
  assert.ok(listingCall);
  assert.deepEqual(listingCall.values, ["movie", 10, 5]);
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
      publicAt: null,
      access: "public",
      seasons: [],
      updatedAt: "2026-11-07 12:00:00",
    }],
    stats: { titles: 0, films: 0, series: 0, videos: 0, episodes: 0 },
    pagination: { limit: 10, offset: 5, count: 1 },
    viewer: { authenticated: false, vip: false, admin: false, entitled: false },
  });
  // The catalogue is per-viewer: it must never be stored in a shared cache.
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
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
          async first() { return /INSERT INTO account_rate_limits/.test(sql) ? { attempts: 1 } : null; },
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
  assert.deepEqual(calls[0].values, [500, 0]);
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

const HOUR = 60 * 60 * 1000;
// The public catalogue test data mirrors the Black Clover report:
// - "scheduled": the 48 h VIP window has not started yet;
// - "early": inside the 48 h VIP window;
// - "released": the public date has passed.
const WINDOW_PUBLIC_AT = new Date(Date.now() + 24 * HOUR).toISOString();
const SCHEDULED_PUBLIC_AT = new Date(Date.now() + 72 * HOUR).toISOString();
const RELEASED_PUBLIC_AT = new Date(Date.now() - 6 * HOUR).toISOString();

const vipRows = [
  catalogTitle({ id: "public", title: "Public" }),
  catalogTitle({ id: "exclusive", title: "Exclusif", vip_exclusive: 1 }),
  catalogTitle({ id: "early", title: "Avant-première", vip_early_access: 1, public_at: WINDOW_PUBLIC_AT }),
  catalogTitle({ id: "scheduled", title: "Avant-première programmée", vip_early_access: 1, public_at: SCHEDULED_PUBLIC_AT }),
  catalogTitle({ id: "released", title: "Avant-première publiée", vip_early_access: 1, public_at: RELEASED_PUBLIC_AT }),
  catalogTitle({ id: "broken", title: "Date manquante", vip_early_access: 1, public_at: null }),
  catalogTitle({ id: "invalid", title: "Date illisible", vip_early_access: 1, public_at: "hier" }),
];

function envFor(options) {
  return { DB: createCatalogD1({ titles: vipRows, ...options }) };
}

function fetchTitles(request, env) {
  return onRequestGet({ request, env }).then(async (response) => {
    const text = await response.text();
    if (response.status !== 200) assert.fail(`expected 200, got ${response.status}: ${text}`);
    return { response, body: JSON.parse(text) };
  });
}

function catalogRequest(options = {}) {
  return new Request("https://cinebox.test/api/catalog", {
    headers: options.account ? { cookie: "__Host-cinebox_session=test-token" } : {},
  });
}

test("a guest sees premiere teasers and VIP-exclusive cards without playback URLs", async () => {
  const { body, response } = await fetchTitles(new Request("https://cinebox.test/api/catalog"), envFor({}));
  assert.deepEqual(body.titles.map((title) => title.id).sort(), ["early", "exclusive", "public", "released", "scheduled"]);
  assert.deepEqual(body.viewer, { authenticated: false, vip: false, admin: false, entitled: false });
  assert.equal(response.headers.get("vary"), "Cookie");
  // No video URL of a VIP title can be present in the payload.
  for (const title of body.titles) assert.ok(!title.videoUrl);
});

test("a guest sees VIP-exclusive teaser metadata but never receives its playback URL", async () => {
  const db = createCatalogD1({
    titles: vipRows,
    sources: [{ title_id: "exclusive", episode_id: null, provider: "uqload", file_code: "exclusive-secret", playback_url: null, encoding_status: "ready" }],
  });
  const { body } = await fetchTitles(new Request("https://cinebox.test/api/catalog"), { DB: db });
  const teaser = body.titles.find((title) => title.id === "exclusive");
  assert.ok(teaser, "the VIP-exclusive title should remain visible as a teaser");
  assert.equal(teaser.videoUrl, undefined);
  assert.equal(JSON.stringify(body).includes("exclusive-secret"), false);
});

test("an authenticated non-VIP account sees scheduled premiere teasers without playback URLs", async () => {
  const { body } = await fetchTitles(
    catalogRequest({ account: ACCOUNT }),
    envFor({ account: ACCOUNT, vip: false, admin: false }),
  );
  assert.deepEqual(body.titles.map((title) => title.id).sort(), ["early", "exclusive", "public", "released", "scheduled"]);
  assert.equal(body.viewer.authenticated, true);
  assert.equal(body.viewer.vip, false);
  assert.equal(body.viewer.entitled, false);
});

test("a VIP member sees scheduled premiere teasers and can play only titles inside the 48-hour window", async () => {
  const { body } = await fetchTitles(
    catalogRequest({ account: ACCOUNT }),
    envFor({ account: ACCOUNT, vip: true }),
  );
  // Scheduled premieres are visible as teasers; invalid dates stay hidden.
  // VIP-exclusive rows are visible to everyone, but playable only by VIP members.
  assert.deepEqual(body.titles.map((title) => title.id).sort(), ["early", "exclusive", "public", "released", "scheduled"]);
  assert.equal(body.viewer.vip, true);
  assert.equal(body.viewer.entitled, true);
  const access = Object.fromEntries(body.titles.map((title) => [title.id, title.access]));
  assert.deepEqual(access, {
    public: "public",
    exclusive: "vip",
    early: "early",
    released: "public",
    scheduled: "scheduled",
  });
});

test("an administrator without VIP sees premiere teasers but receives no playback entitlement", async () => {
  const { body } = await fetchTitles(
    catalogRequest({ account: ACCOUNT }),
    envFor({ account: ACCOUNT, vip: false, admin: true }),
  );
  // Admins inspect restricted rows through /api/catalog/manage. The viewer
  // catalogue grants no VIP access based on the admin role alone.
  assert.deepEqual(body.titles.map((title) => title.id).sort(), ["early", "exclusive", "public", "released", "scheduled"]);
  assert.equal(body.viewer.admin, true);
  assert.equal(body.viewer.entitled, false);
  assert.equal(body.viewer.vip, false);
});

test("an expired VIP membership sees premiere teasers but is not entitled to playback", async () => {
  // The membership lookup is performed with the current instant as bound
  // parameter; a revoked/expired row returns no active membership.
  const { body } = await fetchTitles(
    catalogRequest({ account: ACCOUNT }),
    envFor({ account: ACCOUNT, vip: false }),
  );
  assert.deepEqual(body.titles.map((title) => title.id).sort(), ["early", "exclusive", "public", "released", "scheduled"]);
  assert.equal(body.viewer.vip, false);
});

test("a scheduled premiere never leaks its playback URL to VIP members", async () => {
  const db = createCatalogD1({
    titles: vipRows,
    account: ACCOUNT,
    vip: true,
    sources: [
      { title_id: "scheduled", episode_id: null, provider: "uqload", file_code: "scheduledsecret", playback_url: null, encoding_status: "ready" },
      { title_id: "early", episode_id: null, provider: "uqload", file_code: "earlyok", playback_url: null, encoding_status: "ready" },
    ],
  });
  const { body } = await fetchTitles(catalogRequest({ account: ACCOUNT }), { DB: db });
  const payload = JSON.stringify(body);
  assert.equal(payload.includes("scheduledsecret"), false);
  assert.equal(payload.includes("earlyok"), true);
});

test("catalogue SQL includes every valid scheduled premiere as a teaser without granting playback", async () => {
  const db = createCatalogD1({ titles: vipRows });
  await onRequestGet({ request: new Request("https://cinebox.test/api/catalog"), env: { DB: db } });
  const titlesCall = db.calls.find((call) => /FROM catalog_titles/.test(call.sql) && call.sql.includes("ORDER BY"));
  assert.ok(titlesCall);
  assert.match(titlesCall.sql, /vip_exclusive\)?=1/);
  assert.match(titlesCall.sql, /vip_early_access\)?=0/);
  assert.match(titlesCall.sql, /datetime\(public_at\)/);
  assert.deepEqual(titlesCall.values, [24, 0]);
  const scheduled = (await (await onRequestGet({ request: new Request("https://cinebox.test/api/catalog"), env: { DB: db } })).json()).titles.find((title) => title.id === "scheduled");
  assert.ok(scheduled);
  assert.equal(scheduled.videoUrl, undefined);
});

test("the VIP catalogue includes scheduled premieres while preserving VIP-exclusive rows", async () => {
  const db = createCatalogD1({ titles: vipRows, account: ACCOUNT, vip: true });
  await onRequestGet({ request: catalogRequest({ account: ACCOUNT }), env: { DB: db } });
  const titlesCall = db.calls.find((call) => /FROM catalog_titles/.test(call.sql) && call.sql.includes("ORDER BY"));
  assert.ok(titlesCall);
  assert.match(titlesCall.sql, /vip_exclusive\)?=1/);
  assert.match(titlesCall.sql, /datetime\(public_at\)/);
  assert.deepEqual(titlesCall.values, [24, 0]);
});

test("stats and episode counts follow the same audience as the listing", async () => {
  const db = createCatalogD1({
    titles: vipRows,
    episodes: [
      { id: "e1", title_id: "exclusive", season_number: 1, episode_number: 1, title: "E1", overview: "", duration_seconds: 1, thumbnail_path: null, metadata_json: "{}" },
      { id: "e2", title_id: "public", season_number: 1, episode_number: 1, title: "E2", overview: "", duration_seconds: 1, thumbnail_path: null, metadata_json: "{}" },
      { id: "e3", title_id: "scheduled", season_number: 1, episode_number: 1, title: "E3", overview: "", duration_seconds: 1, thumbnail_path: null, metadata_json: "{}" },
    ],
  });
  const guest = await fetchTitles(new Request("https://cinebox.test/api/catalog?kind=movie"), { DB: db });
  assert.equal(guest.body.stats.titles, 5);
  assert.equal(guest.body.stats.episodes, 3);

  const vip = await fetchTitles(catalogRequest({ account: ACCOUNT }), { DB: createCatalogD1({
    titles: vipRows,
    account: ACCOUNT,
    vip: true,
    episodes: [
      { id: "e1", title_id: "exclusive", season_number: 1, episode_number: 1, title: "E1", overview: "", duration_seconds: 1, thumbnail_path: null, metadata_json: "{}" },
      { id: "e2", title_id: "public", season_number: 1, episode_number: 1, title: "E2", overview: "", duration_seconds: 1, thumbnail_path: null, metadata_json: "{}" },
      { id: "e3", title_id: "scheduled", season_number: 1, episode_number: 1, title: "E3", overview: "", duration_seconds: 1, thumbnail_path: null, metadata_json: "{}" },
    ],
  }) });
  // Every valid premiere and VIP-exclusive row is counted as visible.
  assert.equal(vip.body.stats.titles, 5);
  assert.equal(vip.body.stats.episodes, 3);
});
