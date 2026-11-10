import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPatch } from "../../functions/api/catalog/manage.ts";
import { createFakeD1 } from "./helpers/fake-d1.mjs";
import { ADMIN_ENV, adminHeaders } from "./helpers/admin-auth.mjs";

const VIDEO_ID = "0123456789abcdef0123456789abcdef";
const OTHER_ID = "fedcba9876543210fedcba9876543210";

function request(body, { authenticated = true, extra = {} } = {}) {
  return new Request("https://cinebox.test/api/catalog/manage", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...adminHeaders({ authenticated, extra }) },
    body: JSON.stringify(body),
  });
}

function makeEnv(db) {
  return { ...ADMIN_ENV, DB: db };
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

test("shared catalog management reports a server configuration error without admin secrets", async () => {
  const db = createFakeD1();
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42" }),
    env: { ...makeEnv(db), CINEBOX_SESSION_SECRET: undefined },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "L'administration n'est pas configurée côté serveur." });
});

test("shared catalog management requires D1", async () => {
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42", detachVideoId: VIDEO_ID }),
    env: { ...ADMIN_ENV },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Base de données indisponible." });
});

test("shared catalog management rejects a missing title id", async () => {
  const db = createFakeD1();
  const response = await onRequestPatch({ request: request({ detachVideoId: VIDEO_ID }), env: makeEnv(db) });
  assert.equal(response.status, 400);
  assert.equal(db.calls.length, 0);
});

test("detaching a movie removes the episode link and title metadata in one batch", async () => {
  const original = JSON.stringify({ bunnyVideoId: VIDEO_ID, tmdbId: 42 });
  const db = createFakeD1({
    titles: [{ id: "tmdb:movie:42", metadata_json: original }],
    episodes: [{ id: "e1", title_id: "tmdb:movie:42", stream_uid: VIDEO_ID }],
  });
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42", detachVideoId: VIDEO_ID }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { detached: true, id: "tmdb:movie:42", titleDetached: true });

  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 2);
  assert.match(db.batches[0][0].sql, /UPDATE catalog_episodes SET stream_uid=NULL/);
  assert.match(db.batches[0][1].sql, /UPDATE catalog_titles SET metadata_json=\?/);
  assert.match(db.batches[0][1].sql, /AND metadata_json=\?/);
  assert.deepEqual(db.batches[0][1].values, [JSON.stringify({ tmdbId: 42 }), "tmdb:movie:42", original]);

  assert.equal(db.state.episodes[0].stream_uid, null);
  assert.deepEqual(JSON.parse(db.state.titles[0].metadata_json), { tmdbId: 42 });
});

test("detaching a series only clears the episode link when the title has no Bunny metadata", async () => {
  const original = JSON.stringify({ tmdbId: 42 });
  const db = createFakeD1({
    titles: [{ id: "tmdb:series:42", metadata_json: original }],
    episodes: [{ id: "e1", title_id: "tmdb:series:42", stream_uid: VIDEO_ID }],
  });
  const response = await onRequestPatch({
    request: request({ id: "tmdb:series:42", detachVideoId: VIDEO_ID }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { detached: true, id: "tmdb:series:42", titleDetached: false });
  assert.equal(db.batches[0].length, 1);
  assert.equal(db.state.episodes[0].stream_uid, null);
  assert.equal(db.state.titles[0].metadata_json, original);
});

test("detaching a video is scoped to the requested title", async () => {
  const db = createFakeD1({
    titles: [
      { id: "tmdb:series:42", metadata_json: JSON.stringify({ tmdbId: 42 }) },
      { id: "tmdb:series:43", metadata_json: JSON.stringify({ tmdbId: 43 }) },
    ],
    episodes: [
      { id: "e1", title_id: "tmdb:series:42", stream_uid: VIDEO_ID },
      { id: "e2", title_id: "tmdb:series:43", stream_uid: VIDEO_ID },
    ],
  });
  const response = await onRequestPatch({
    request: request({ id: "tmdb:series:42", detachVideoId: VIDEO_ID }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(db.batches[0][0].values, ["tmdb:series:42", VIDEO_ID]);
  assert.equal(db.state.episodes.find((episode) => episode.id === "e1").stream_uid, null);
  assert.equal(db.state.episodes.find((episode) => episode.id === "e2").stream_uid, VIDEO_ID);
});

test("a failed detach batch leaves D1 unchanged", async () => {
  const original = JSON.stringify({ bunnyVideoId: VIDEO_ID, tmdbId: 42 });
  const db = createFakeD1({
    titles: [{ id: "tmdb:movie:42", metadata_json: original }],
    episodes: [{ id: "e1", title_id: "tmdb:movie:42", stream_uid: VIDEO_ID }],
    failBatch: true,
  });
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42", detachVideoId: VIDEO_ID }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Dissociation impossible." });
  assert.equal(db.state.episodes[0].stream_uid, VIDEO_ID);
  assert.equal(db.state.titles[0].metadata_json, original);
});

test("a concurrent metadata edit is reported as a conflict", async () => {
  const db = createFakeD1({
    titles: [{ id: "tmdb:movie:42", metadata_json: JSON.stringify({ bunnyVideoId: VIDEO_ID, tmdbId: 42 }) }],
    episodes: [{ id: "e1", title_id: "tmdb:movie:42", stream_uid: VIDEO_ID }],
    skipTitleGuard: true,
  });
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42", detachVideoId: VIDEO_ID }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.conflict, true);
  assert.match(body.error, /modifiée entre-temps/);
  assert.equal(JSON.parse(db.state.titles[0].metadata_json).bunnyVideoId, VIDEO_ID);
});

test("detaching from an unknown title returns 404 without writing", async () => {
  const db = createFakeD1();
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:999", detachVideoId: VIDEO_ID }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 404);
  assert.equal(db.batches.length, 0);
});

test("malformed title metadata does not block the episode detach", async () => {
  const db = createFakeD1({
    titles: [{ id: "tmdb:movie:42", metadata_json: "{" }],
    episodes: [{ id: "e1", title_id: "tmdb:movie:42", stream_uid: VIDEO_ID }],
  });
  const response = await onRequestPatch({
    request: request({ id: "tmdb:movie:42", detachVideoId: VIDEO_ID }),
    env: makeEnv(db),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { detached: true, id: "tmdb:movie:42", titleDetached: false });
  assert.equal(db.batches[0].length, 1);
  assert.equal(db.state.episodes[0].stream_uid, null);
  assert.equal(db.state.titles[0].metadata_json, "{");
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
