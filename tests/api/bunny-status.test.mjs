import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/bunny/status.ts";
import { ADMIN_ENV, adminHeaders } from "./helpers/admin-auth.mjs";

function request({ authenticated = true, extra = {} } = {}) {
  return new Request("https://cinebox.test/api/bunny/status", {
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

test("Bunny status rejects unauthenticated visitors", async () => {
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

test("Bunny status rejects a legacy Bearer token", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("upstream must not be called"); };
  try {
    const response = await onRequestGet({
      request: request({
        authenticated: false,
        extra: { authorization: "Bearer test-admin-token-that-is-long-enough-for-testing-123" },
      }),
      env: bunnyEnv(),
    });
    assert.equal(response.status, 401);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bunny status rejects a tampered session cookie", async () => {
  const response = await onRequestGet({
    request: request({ authenticated: false, extra: { cookie: "__Host-cinebox_admin=not-a-valid-session" } }),
    env: bunnyEnv(),
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Session administrateur expirée/);
});

test("Bunny status reports a server configuration error without admin secrets", async () => {
  const response = await onRequestGet({ request: request(), env: { ...bunnyEnv(), CINEBOX_ADMIN_PASSWORD_HASH: undefined } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "L'administration n'est pas configurée côté serveur." });
});

test("Bunny status requires server-side Bunny credentials", async () => {
  const env = bunnyEnv();
  delete env.BUNNY_STREAM_API_KEY;
  delete env.BUNNY_STREAM_LIBRARY_ID;
  const response = await onRequestGet({ request: request(), env });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    connected: false,
    error: "La connexion Bunny Stream n'est pas configurée.",
  });
});

test("Bunny status rejects an invalid library id without calling upstream", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("upstream must not be called"); };
  try {
    const response = await onRequestGet({
      request: request(),
      env: bunnyEnv({ BUNNY_STREAM_LIBRARY_ID: "../bad" }),
    });
    assert.equal(response.status, 503);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bunny status never returns the API key", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("AccessKey"), "test-secret");
    return new Response(JSON.stringify({ totalItems: 7, items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const response = await onRequestGet({ request: request(), env: bunnyEnv() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      connected: true,
      libraryId: "802826",
      cdnHostname: "vz-ef2cb822-c35.b-cdn.net",
      videoCount: 7,
    });
    assert.equal(JSON.stringify(body).includes("test-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
