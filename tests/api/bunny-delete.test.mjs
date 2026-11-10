import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/bunny/delete.ts";
import { createFakeD1, installFetch } from "./helpers/fake-d1.mjs";
import { ADMIN_ENV, adminHeaders } from "./helpers/admin-auth.mjs";

const VIDEO_ID = "0123456789abcdef0123456789abcdef";
const OTHER_ID = "fedcba9876543210fedcba9876543210";

function request(body, { authenticated = true, extra = {} } = {}) {
  return new Request("https://cinebox.test/api/bunny/delete", {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders({ authenticated, extra }) },
    body: JSON.stringify(body),
  });
}

function makeEnv(db, overrides = {}) {
  return {
    ...ADMIN_ENV,
    BUNNY_STREAM_API_KEY: "test-secret",
    BUNNY_STREAM_LIBRARY_ID: "802826",
    DB: db,
    ...overrides,
  };
}

function baseState() {
  return {
    titles: [
      { id: "tmdb:movie:42", metadata_json: JSON.stringify({ bunnyVideoId: VIDEO_ID, tmdbId: 42 }) },
      { id: "tmdb:movie:43", metadata_json: JSON.stringify({ bunnyVideoId: OTHER_ID, tmdbId: 43 }) },
    ],
    episodes: [
      { id: "e1", title_id: "tmdb:movie:42", stream_uid: VIDEO_ID },
      { id: "e2", title_id: "tmdb:movie:43", stream_uid: OTHER_ID },
    ],
  };
}

test("Bunny delete rejects unauthenticated requests before touching D1 or Bunny", async () => {
  const db = createFakeD1(baseState());
  const bunny = installFetch(() => { throw new Error("Bunny must not be called"); });
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }, { authenticated: false }), env: makeEnv(db) });
    assert.equal(response.status, 401);
    assert.equal(db.calls.length, 0);
    assert.equal(bunny.calls.length, 0);
  } finally {
    bunny.restore();
  }
});

test("Bunny delete rejects a legacy Bearer token", async () => {
  const db = createFakeD1(baseState());
  const bunny = installFetch(() => { throw new Error("Bunny must not be called"); });
  try {
    const response = await onRequestPost({
      request: request({ videoId: VIDEO_ID }, {
        authenticated: false,
        extra: { authorization: "Bearer test-admin-token-that-is-long-enough-for-testing-123" },
      }),
      env: makeEnv(db),
    });
    assert.equal(response.status, 401);
    assert.equal(bunny.calls.length, 0);
  } finally {
    bunny.restore();
  }
});

test("Bunny delete reports a server configuration error without admin secrets", async () => {
  const db = createFakeD1(baseState());
  const response = await onRequestPost({
    request: request({ videoId: VIDEO_ID }),
    env: makeEnv(db, { CINEBOX_ADMIN_PASSWORD_HASH: undefined }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "L'administration n'est pas configurée côté serveur." });
});

test("Bunny delete stays disabled without server configuration", async () => {
  const db = createFakeD1(baseState());
  const response = await onRequestPost({
    request: request({ videoId: VIDEO_ID }),
    env: makeEnv(db, { BUNNY_STREAM_API_KEY: undefined }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Configuration Bunny ou D1 manquante." });
});

test("Bunny delete rejects an invalid video id", async () => {
  const db = createFakeD1(baseState());
  const bunny = installFetch(() => { throw new Error("Bunny must not be called"); });
  try {
    const response = await onRequestPost({ request: request({ videoId: "not-a-guid" }), env: makeEnv(db) });
    assert.equal(response.status, 400);
    assert.equal(db.calls.length, 0);
    assert.equal(bunny.calls.length, 0);
  } finally {
    bunny.restore();
  }
});

test("Bunny delete detaches D1 in one batch before deleting the video", async () => {
  const db = createFakeD1(baseState());
  let stateAtDelete = null;
  const bunny = installFetch(() => {
    stateAtDelete = structuredClone(db.state);
    return new Response(null, { status: 200 });
  });
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }), env: makeEnv(db) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      deleted: true,
      videoId: VIDEO_ID,
      detached: true,
      bunnyDeleted: true,
      alreadyAbsent: false,
    });

    assert.equal(db.batches.length, 1);
    assert.equal(db.batches[0].length, 2);
    assert.match(db.batches[0][0].sql, /UPDATE catalog_episodes SET stream_uid=NULL/);
    assert.match(db.batches[0][1].sql, /UPDATE catalog_titles SET metadata_json=\?/);
    assert.match(db.batches[0][1].sql, /AND metadata_json=\?/);

    assert.equal(db.state.episodes.find((episode) => episode.id === "e1").stream_uid, null);
    assert.equal(db.state.episodes.find((episode) => episode.id === "e2").stream_uid, OTHER_ID);
    const detached = JSON.parse(db.state.titles.find((title) => title.id === "tmdb:movie:42").metadata_json);
    assert.equal(detached.bunnyVideoId, undefined);
    assert.equal(detached.tmdbId, 42);
    const untouched = JSON.parse(db.state.titles.find((title) => title.id === "tmdb:movie:43").metadata_json);
    assert.equal(untouched.bunnyVideoId, OTHER_ID);

    assert.equal(bunny.calls.length, 1);
    assert.equal(bunny.calls[0].method, "DELETE");
    assert.match(bunny.calls[0].url, /library\/802826\/videos\/0123456789abcdef0123456789abcdef$/);
    assert.equal(bunny.calls[0].headers.get("AccessKey"), "test-secret");
    assert.equal(JSON.stringify(stateAtDelete).includes(VIDEO_ID), false);
  } finally {
    bunny.restore();
  }
});

test("Bunny delete treats an already missing video (404) as an idempotent success", async () => {
  const db = createFakeD1(baseState());
  const bunny = installFetch(() => new Response(null, { status: 404 }));
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }), env: makeEnv(db) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      deleted: true,
      videoId: VIDEO_ID,
      detached: true,
      bunnyDeleted: true,
      alreadyAbsent: true,
    });
    assert.equal(db.state.episodes.find((episode) => episode.id === "e1").stream_uid, null);
  } finally {
    bunny.restore();
  }
});

test("a Bunny refusal keeps D1 detached and returns a retryable response", async () => {
  const db = createFakeD1(baseState());
  const bunny = installFetch(() => new Response(null, { status: 500 }));
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }), env: makeEnv(db) });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.detached, true);
    assert.equal(body.bunnyDeleted, false);
    assert.equal(body.retryable, true);
    assert.match(body.error, /Bunny n'a pas confirmé la suppression/);
    assert.equal(db.state.episodes.find((episode) => episode.id === "e1").stream_uid, null);
    assert.equal(JSON.parse(db.state.titles.find((title) => title.id === "tmdb:movie:42").metadata_json).bunnyVideoId, undefined);
  } finally {
    bunny.restore();
  }
});

test("a Bunny API key refusal explains how to recover", async () => {
  const db = createFakeD1(baseState());
  const bunny = installFetch(() => new Response(null, { status: 403 }));
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }), env: makeEnv(db) });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.bunnyDeleted, false);
    assert.match(body.error, /Bunny a refusé la suppression/);
  } finally {
    bunny.restore();
  }
});

test("a network failure after D1 detachment is reported as retryable", async () => {
  const db = createFakeD1(baseState());
  const bunny = installFetch(() => { throw new Error("network down"); });
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }), env: makeEnv(db) });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.detached, true);
    assert.equal(body.bunnyDeleted, false);
    assert.equal(body.retryable, true);
    assert.match(body.error, /Bunny n'a pas répondu/);
  } finally {
    bunny.restore();
  }
});

test("a failed D1 batch leaves Bunny untouched and D1 unchanged", async () => {
  const db = createFakeD1({ ...baseState(), failBatch: true });
  const bunny = installFetch(() => { throw new Error("Bunny must not be called"); });
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }), env: makeEnv(db) });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Aucune vidéo n'a été supprimée/);
    assert.equal(bunny.calls.length, 0);
    assert.equal(db.state.episodes.find((episode) => episode.id === "e1").stream_uid, VIDEO_ID);
    assert.equal(JSON.parse(db.state.titles.find((title) => title.id === "tmdb:movie:42").metadata_json).bunnyVideoId, VIDEO_ID);
  } finally {
    bunny.restore();
  }
});

test("an unreadable D1 reference aborts before deleting Bunny", async () => {
  const db = createFakeD1({ ...baseState(), failQuery: "SELECT id, metadata_json" });
  const bunny = installFetch(() => { throw new Error("Bunny must not be called"); });
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }), env: makeEnv(db) });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Aucune vidéo n'a été supprimée/);
    assert.equal(bunny.calls.length, 0);
  } finally {
    bunny.restore();
  }
});

test("a concurrent metadata edit prevents the Bunny deletion", async () => {
  const db = createFakeD1({ ...baseState(), skipTitleGuard: true });
  const bunny = installFetch(() => { throw new Error("Bunny must not be called"); });
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }), env: makeEnv(db) });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.conflict, true);
    assert.equal(body.bunnyDeleted, false);
    assert.equal(body.retryable, true);
    assert.equal(bunny.calls.length, 0);
    assert.equal(JSON.parse(db.state.titles.find((title) => title.id === "tmdb:movie:42").metadata_json).bunnyVideoId, VIDEO_ID);
  } finally {
    bunny.restore();
  }
});

test("malformed metadata is ignored while episodes are still detached", async () => {
  const db = createFakeD1({
    titles: [{ id: "tmdb:movie:42", metadata_json: `{"bunnyVideoId":"${VIDEO_ID}"` }],
    episodes: [{ id: "e1", title_id: "tmdb:movie:42", stream_uid: VIDEO_ID }],
  });
  const bunny = installFetch(() => new Response(null, { status: 200 }));
  try {
    const response = await onRequestPost({ request: request({ videoId: VIDEO_ID }), env: makeEnv(db) });
    assert.equal(response.status, 200);
    assert.equal(db.batches[0].length, 1);
    assert.equal(db.state.episodes[0].stream_uid, null);
    assert.equal(db.state.titles[0].metadata_json, `{"bunnyVideoId":"${VIDEO_ID}"`);
  } finally {
    bunny.restore();
  }
});
