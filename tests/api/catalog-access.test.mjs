import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/catalog/access.ts";
import { ACCOUNT, catalogTitle, createCatalogD1 } from "./helpers/catalog-d1.mjs";

const FUTURE = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

function env(options) {
  return { DB: createCatalogD1(options) };
}

function get(id, options) {
  const url = id === null ? "https://cinebox.test/api/catalog/access" : `https://cinebox.test/api/catalog/access?id=${encodeURIComponent(id)}`;
  return onRequestGet({
    request: new Request(url, {
      headers: options.account ? { cookie: "__Host-cinebox_session=test-token" } : {},
    }),
    env: env(options),
  });
}

test("access requires a title id", async () => {
  const response = await get(null, { titles: [] });
  assert.equal(response.status, 400);
});

test("access fails with 503 when D1 is unavailable", async () => {
  const response = await onRequestGet({ request: new Request("https://cinebox.test/api/catalog/access?id=x"), env: {} });
  assert.equal(response.status, 503);
});

test("a guest cannot open a VIP-exclusive title or its playback URL", async () => {
  const response = await get("tmdb:movie:1", {
    titles: [catalogTitle({
      id: "tmdb:movie:1", vip_exclusive: 1,
    })],
    sources: [{ title_id: "tmdb:movie:1", episode_id: null, provider: "uqload", file_code: "secret", playback_url: null, encoding_status: "ready" }],
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.deepEqual(body, { error: "Ce titre n’est pas disponible." });
  assert.equal(JSON.stringify(body).includes("secret"), false);
});

test("a guest cannot open an early-access title before its public date", async () => {
  const response = await get("tmdb:movie:1", {
    titles: [catalogTitle({ id: "tmdb:movie:1", vip_early_access: 1, public_at: FUTURE })],
    sources: [{ title_id: "tmdb:movie:1", episode_id: null, provider: "uqload", file_code: "secret", playback_url: null, encoding_status: "ready" }],
  });
  assert.equal(response.status, 404);
});

test("a guest can open an early-access title once the public date passed", async () => {
  const response = await get("tmdb:movie:1", {
    titles: [catalogTitle({ id: "tmdb:movie:1", vip_early_access: 1, public_at: PAST })],
    sources: [{ title_id: "tmdb:movie:1", episode_id: null, provider: "uqload", file_code: "public", playback_url: null, encoding_status: "ready" }],
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.title.access, "public");
  assert.ok(body.title.videoUrl);
  assert.equal(body.viewer.entitled, false);
  // Personalised answer: never cacheable by Cloudflare or the browser.
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("vary"), "Cookie");
});

test("a VIP member receives a VIP-exclusive title with its playback URL", async () => {
  const response = await get("tmdb:movie:1", {
    titles: [catalogTitle({ id: "tmdb:movie:1", vip_exclusive: 1 })],
    sources: [{ title_id: "tmdb:movie:1", episode_id: null, provider: "uqload", file_code: "vipcode", playback_url: null, encoding_status: "ready" }],
    account: ACCOUNT, vip: true,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.title.vipExclusive, true);
  assert.equal(body.title.access, "vip");
  assert.ok(body.title.videoUrl);
  assert.equal(body.viewer.vip, true);
  assert.equal(body.viewer.entitled, true);
});

test("an administrator receives a VIP-exclusive title without a VIP membership", async () => {
  const response = await get("tmdb:movie:1", {
    titles: [catalogTitle({ id: "tmdb:movie:1", vip_exclusive: 1 })],
    account: ACCOUNT, vip: false, admin: true,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.viewer.admin, true);
  assert.equal(body.viewer.vip, false);
});

test("a downgraded (ex-VIP) account is refused like any guest", async () => {
  const response = await get("tmdb:movie:1", {
    titles: [catalogTitle({ id: "tmdb:movie:1", vip_exclusive: 1 })],
    account: ACCOUNT, vip: false, admin: false,
  });
  assert.equal(response.status, 404);
});

test("an unpublished title answers 404 even for an administrator", async () => {
  const response = await get("tmdb:movie:1", {
    titles: [catalogTitle({ id: "tmdb:movie:1", published: 0 })],
    account: ACCOUNT, vip: true, admin: true,
  });
  assert.equal(response.status, 404);
});

test("an unknown id and a forbidden id are indistinguishable", async () => {
  const unknown = await get("tmdb:movie:404", { titles: [], account: ACCOUNT });
  const forbidden = await get("tmdb:movie:1", {
    titles: [catalogTitle({ id: "tmdb:movie:1", vip_exclusive: 1 })],
    account: ACCOUNT,
  });
  assert.equal(unknown.status, 404);
  assert.equal(forbidden.status, 404);
  assert.deepEqual(await unknown.json(), await forbidden.json());
});

test("episodes and their sources are returned only to entitled viewers", async () => {
  const titles = [catalogTitle({
    id: "tmdb:series:9", kind: "series", vip_early_access: 1, public_at: FUTURE,
  })];
  const episodes = [{
    id: "tmdb:series:9:s1:e1", title_id: "tmdb:series:9", season_number: 1, episode_number: 1,
    title: "Épisode 1", overview: "", duration_seconds: 1500, thumbnail_path: null, metadata_json: "{}",
  }];
  const sources = [{ title_id: "tmdb:series:9", episode_id: "tmdb:series:9:s1:e1", provider: "uqload", file_code: "episode1", playback_url: null, encoding_status: "ready" }];

  const guest = await get("tmdb:series:9", { titles, episodes, sources, account: ACCOUNT });
  assert.equal(guest.status, 404);

  const vip = await get("tmdb:series:9", { titles, episodes, sources, account: ACCOUNT, vip: true });
  assert.equal(vip.status, 200);
  const body = await vip.json();
  assert.equal(body.title.seasons[0].episodes[0].number, 1);
  assert.ok(body.title.seasons[0].episodes[0].videoUrl);
});
