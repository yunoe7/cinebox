import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/bunny/status.ts";

test("Bunny status requires server-side credentials", async () => {
  const response = await onRequestGet({ env: {} });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    connected: false,
    error: "La connexion Bunny Stream n'est pas configurée.",
  });
});

test("Bunny status rejects an invalid library id without calling upstream", async () => {
  const response = await onRequestGet({
    env: { BUNNY_STREAM_API_KEY: "secret", BUNNY_STREAM_LIBRARY_ID: "../bad" },
  });
  assert.equal(response.status, 503);
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
    const response = await onRequestGet({
      env: {
        BUNNY_STREAM_API_KEY: "test-secret",
        BUNNY_STREAM_LIBRARY_ID: "802826",
        BUNNY_STREAM_CDN_HOSTNAME: "vz-ef2cb822-c35.b-cdn.net",
      },
    });
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
