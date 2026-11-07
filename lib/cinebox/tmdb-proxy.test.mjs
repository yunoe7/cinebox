import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/tmdb/[[path]].ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => { globalThis.fetch = originalFetch; });

test("le proxy refuse l'absence de secret sans requête sortante", async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("unexpected"); };
  const response = await onRequestGet({ request: new Request("https://local.test/api/tmdb/search?query=test"), env: {} });
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test("la recherche est bornée et le bearer reste uniquement côté serveur", async () => {
  let upstream;
  globalThis.fetch = async (input, init) => {
    upstream = { url: String(input), authorization: new Headers(init?.headers).get("authorization") };
    return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } });
  };
  const response = await onRequestGet({
    request: new Request("https://local.test/api/tmdb/search?query=Alien&kind=multi&year=1979"),
    env: { TMDB_READ_ACCESS_TOKEN: "unit-test-token" },
  });
  assert.equal(response.status, 200);
  assert.equal(upstream.authorization, "Bearer unit-test-token");
  assert.match(upstream.url, /^https:\/\/api\.themoviedb\.org\/3\/search\/multi\?/);
  assert.match(upstream.url, /year=1979/);
  assert.equal((await response.json()).results.length, 0);
});

test("une clé TMDB v3 reste côté serveur et n'est pas renvoyée au navigateur", async () => {
  let upstream;
  const privateKey = "0123456789abcdef0123456789abcdef";
  globalThis.fetch = async (input, init) => {
    upstream = { url: String(input), authorization: new Headers(init?.headers).get("authorization") };
    return new Response(JSON.stringify({ results: [{ id: 123, title: "Fixture" }] }), { headers: { "content-type": "application/json" } });
  };
  const response = await onRequestGet({ request: new Request("https://local.test/api/tmdb/search?query=Fixture"), env: { TMDB_READ_ACCESS_TOKEN: privateKey } });
  assert.equal(response.status, 200);
  assert.match(upstream.url, /api_key=0123456789abcdef0123456789abcdef/);
  assert.equal(upstream.authorization, null);
  assert.doesNotMatch(await response.text(), new RegExp(privateKey));
});

test("le proxy refuse les chemins arbitraires, les identifiants invalides et les images traversantes", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("{}"); };
  for (const path of ["/api/tmdb/account", "/api/tmdb/movie/1%2Faccount"]) {
    const response = await onRequestGet({ request: new Request(`https://local.test${path}`), env: { TMDB_READ_ACCESS_TOKEN: "unit-test-token" } });
    assert.equal(response.status, 404);
  }
  const image = await onRequestGet({ request: new Request("https://local.test/api/tmdb/image?path=%2F..%2Faccount"), env: { TMDB_READ_ACCESS_TOKEN: "unit-test-token" } });
  assert.equal(image.status, 400);
  assert.equal(calls, 0);
});

test("les erreurs de quota TMDB deviennent un message contrôlé avec retry-after", async () => {
  globalThis.fetch = async () => new Response("rate limited", { status: 429, headers: { "retry-after": "8" } });
  const response = await onRequestGet({ request: new Request("https://local.test/api/tmdb/search?query=Film"), env: { TMDB_READ_ACCESS_TOKEN: "unit-test-token" } });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "8");
  assert.match((await response.json()).error, /Limite/);
});

test("un refus TMDB signale une vérification du jeton sans exposer les détails upstream", async () => {
  globalThis.fetch = async () => new Response("token was rejected: confidential-body", { status: 401 });
  const response = await onRequestGet({ request: new Request("https://local.test/api/tmdb/search?query=Film"), env: { TMDB_READ_ACCESS_TOKEN: "unit-test-token" } });
  const body = await response.text();
  assert.equal(response.status, 502);
  assert.match(body, /jeton Read Access/);
  assert.doesNotMatch(body, /confidential-body|unit-test-token|token was rejected/i);
});
