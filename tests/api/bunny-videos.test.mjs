import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/bunny/videos.ts";
import { ADMIN_ENV, adminHeaders } from "./helpers/admin-auth.mjs";

const VIDEO_ID = "0123456789abcdef0123456789abcdef";

function request({ authenticated = true, extra = {} } = {}) {
  return new Request("https://cinebox.test/api/bunny/videos", {
    headers: adminHeaders({ authenticated, extra }),
  });
}

function bunnyEnv(overrides = {}) {
  return {
    ...ADMIN_ENV,
    BUNNY_STREAM_API_KEY: "test-secret",
    BUNNY_STREAM_LIBRARY_ID: "802826",
    BUNNY_STREAM_CDN_HOSTNAME: "vz-ef2cb822-c35.b-cdn.net",
    ...overrides,
  };
}

test("Bunny videos rejects unauthenticated visitors", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("upstream must not be called"); };
  try {
    const response = await onRequestGet({ request: request({ authenticated: false }), env: bunnyEnv() });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Authentification administrateur requise." });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bunny videos rejects a legacy Bearer token", async () => {
  const response = await onRequestGet({
    request: request({
      authenticated: false,
      extra: { authorization: "Bearer test-admin-token-that-is-long-enough-for-testing-123" },
    }),
    env: bunnyEnv(),
  });
  assert.equal(response.status, 401);
});

test("Bunny videos reports a server configuration error without admin secrets", async () => {
  const response = await onRequestGet({
    request: request(),
    env: { ...bunnyEnv(), CINEBOX_SESSION_SECRET: undefined },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "L'administration n'est pas configurée côté serveur." });
});

test("Bunny videos requires server-side Bunny credentials", async () => {
  const env = bunnyEnv();
  delete env.BUNNY_STREAM_API_KEY;
  const response = await onRequestGet({ request: request(), env });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "La bibliothèque Bunny Stream n'est pas configurée.",
  });
});

test("Bunny videos returns the library to an authenticated administrator", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(new Headers(init?.headers).get("AccessKey"), "test-secret");
    assert.match(String(input), /library\/802826\/videos/);
    return new Response(JSON.stringify({
      totalItems: 1,
      items: [{
        guid: VIDEO_ID,
        title: "Film test",
        status: 4,
        length: 120,
        dateUploaded: "2026-01-02T03:04:05.000Z",
        thumbnailFileName: "thumb.jpg",
        availableResolutions: "720p,1080p",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await onRequestGet({ request: request(), env: bunnyEnv() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      libraryId: "802826",
      total: 1,
      videos: [{
        id: VIDEO_ID,
        title: "Film test",
        status: 4,
        durationSeconds: 120,
        uploadedAt: "2026-01-02T03:04:05.000Z",
        thumbnailUrl: "https://vz-ef2cb822-c35.b-cdn.net/thumb.jpg",
        availableResolutions: "720p,1080p",
      }],
    });
    assert.equal(JSON.stringify(body).includes("test-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
