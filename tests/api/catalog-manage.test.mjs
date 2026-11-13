import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPatch } from "../../functions/api/catalog/manage.ts";
import { createFakeD1 } from "./helpers/fake-d1.mjs";
import { ADMIN_ENV, discordAdminHeaders, withDiscordAdminDb } from "./helpers/admin-auth.mjs";

function request(body, { authenticated = true, extra = {} } = {}) {
  return new Request("https://cinebox.test/api/catalog/manage", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...discordAdminHeaders({ authenticated, extra }) },
    body: JSON.stringify(body),
  });
}

function makeEnv(db) {
  return { ...ADMIN_ENV, DB: withDiscordAdminDb(db) };
}

test("shared catalog management rejects unauthenticated requests", async () => {
  const db = createFakeD1();
  const response = await onRequestPatch({ request: request({ id: "tmdb:movie:42" }, { authenticated: false }), env: makeEnv(db) });
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});

test("shared catalog management rejects a legacy Bearer token", async () => {
  const db = createFakeD1();
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42" }, {
      authenticated: false,
      extra: { authorization: "Bearer test-admin-token-that-is-long-enough-for-testing-123" },
    }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});

test("shared catalog management does not require a separate admin password", async () => {
  const db = createFakeD1();
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42" }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 200);
});

test("shared catalog management requires D1", async () => {
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42", published: true }),
    env: { ...ADMIN_ENV },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Base de données indisponible." });
});

test("shared catalog management rejects a missing title id", async () => {
  const db = createFakeD1();
  const response = await onRequestPatch({ request: request({ title: "Sans identifiant" }), env: makeEnv(db) });
  assert.equal(response.status, 400);
  assert.equal(db.calls.length, 0);
});

test("listing the shared catalogue requires authentication", async () => {
  const db = createFakeD1();
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog/manage", {
      headers: discordAdminHeaders({ authenticated: false }),
    }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 401);
  assert.equal(db.calls.length, 0);
});

test("listing the shared catalogue returns titles with their episodes", async () => {
  const db = createFakeD1({
    titles: [{
      id: "tmdb:series:42", kind: "series", title: "Série", overview: "", release_date: null,
      poster_path: null, backdrop_path: null, genres_json: '["Drame"]',
      metadata_json: '{"tmdbId":42}', published: 1, updated_at: "2024-01-01T00:00:00Z",
    }],
    episodes: [{
      id: "tmdb:series:42:s1:e1", title_id: "tmdb:series:42", season_number: 1, episode_number: 1,
      title: "E1", overview: "", duration_seconds: 2700, thumbnail_path: null, metadata_json: "{}",
    }],
  });
  const response = await onRequestGet({
    request: new Request("https://cinebox.test/api/catalog/manage", { headers: discordAdminHeaders() }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.titles.length, 1);
  assert.deepEqual(body.titles[0].genres, ["Drame"]);
  assert.deepEqual(body.titles[0].metadata, { tmdbId: 42 });
  assert.equal(body.titles[0].episodes.length, 1);
  assert.equal(body.titles[0].episodes[0].title, "E1");
});

test("publishing a shared title still works through the single-statement path", async () => {
  const db = createFakeD1({ titles: [{ id: "tmdb:movie:42", metadata_json: "{}", published: 0 }] });
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42", published: true }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { updated: true, id: "tmdb:movie:42", published: true });
  assert.equal(db.state.titles[0].published, 1);
});

test("editing a shared title still uses the COALESCE update", async () => {
  const db = createFakeD1({ titles: [{ id: "tmdb:movie:42", metadata_json: "{}" }] });
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42", title: "Nouveau titre" }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { updated: true, id: "tmdb:movie:42" });
  assert.ok(db.calls.some((call) => /UPDATE catalog_titles SET title=COALESCE/.test(call.sql)));
});

test("editing an unknown title returns 404 without writing", async () => {
  const db = createFakeD1();
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:999", title: "Inconnu" }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 404);
  assert.equal(db.calls.some((call) => /UPDATE/.test(call.sql)), false);
});
