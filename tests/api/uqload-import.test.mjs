import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/uqload/[[path]].ts";
import { withDiscordAdminDb, discordAdminHeaders } from "./helpers/admin-auth.mjs";

const CODE = "abc123def456";

function makeDb({ titleKind = "movie", existingSource = null } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) { call.values = values; return this; },
        async all() {\n          if (/FROM catalog_titles WHERE id=\\?/.test(sql)) {\n            return { success: true, results: [{ id: call.values[0], kind: titleKind }] };\n          }\n          if (/FROM catalog_media_sources WHERE provider=\\? AND file_code=\\?/.test(sql)) {\n            return { success: true, results: existingSource ? [existingSource] : [] };\n          }\n          return { success: true, results: [] };\n        },\n        async run() { return { success: true }; },
      };
    },
    batch: async () => [],
  };
  return { db, calls };
}

function makeRequest(body, { method = "POST" } = {}) {
  return new Request("https://cinebox.test/api/uqload/import", {
    method,
    headers: { "content-type": "application/json", ...discordAdminHeaders() },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function withUqloadFetch(payload, run) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    return { result: await run(), requests };
  } finally {
    globalThis.fetch = original;
  }
}

test("l'import d'une URL Uqload complète stocke une URL uqload.vc prête", async () => {
  const { db, calls } = makeDb();
  const env = { DB: withDiscordAdminDb(db), UQLOAD_API_KEY: "unit-test-key" };
  const url = `https://uqload.vc/embed-${CODE}.html`;
  const { result } = await withUqloadFetch(
    { status: 200, result: [{ canplay: 1, file_quality: "1080p", uploaded: "2026-01-02T03:04:05Z" }] },
    () => onRequestPost({ request: makeRequest({ url, titleId: "t1" }), env }),
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.playbackUrl, `https://uqload.vc/embed-${CODE}.html`);
  assert.equal(body.encodingStatus, "ready");

  const insert = calls.find((call) => /INSERT INTO catalog_media_sources/.test(call.sql));
  assert.ok(insert, "the source must be inserted");
  assert.equal(insert.values[6], `https://uqload.vc/embed-${CODE}.html`);
  assert.equal(insert.values[7], "1080p");
  assert.equal(insert.values[8], "ready");
  assert.equal(insert.values[9], "2026-01-02T03:04:05.000Z");
});

test("canplay=0 marque la source comme en cours d'encodage", async () => {
  const { db } = makeDb();
  const env = { DB: withDiscordAdminDb(db), UQLOAD_API_KEY: "unit-test-key" };
  const { result } = await withUqloadFetch(
    { status: 200, result: [{ canplay: 0 }] },
    () => onRequestPost({ request: makeRequest({ url: `https://uqload.vc/embed-${CODE}.html`, titleId: "t1" }), env }),
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).encodingStatus, "processing");
});

test("l'import accepte encore /file/info dont result est un objet", async () => {
  const { db } = makeDb();
  const env = { DB: withDiscordAdminDb(db), UQLOAD_API_KEY: "unit-test-key" };
  const { result } = await withUqloadFetch(
    { status: 200, result: { canplay: "1" } },
    () => onRequestPost({ request: makeRequest({ url: `https://uqload.vc/${CODE}.html`, titleId: "t1" }), env }),
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).encodingStatus, "ready");
});

test("un canplay absent n'invente pas un statut prêt", async () => {
  const { db } = makeDb();
  const env = { DB: withDiscordAdminDb(db), UQLOAD_API_KEY: "unit-test-key" };
  const { result } = await withUqloadFetch(
    { status: 200, result: [{}] },
    () => onRequestPost({ request: makeRequest({ url: `https://uqload.vc/embed-${CODE}.html`, titleId: "t1" }), env }),
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).encodingStatus, "pending");
});

test("un code brut reste refusé : le client doit envoyer une URL complète", async () => {
  const { db, calls } = makeDb();
  const env = { DB: withDiscordAdminDb(db), UQLOAD_API_KEY: "unit-test-key" };
  let fetched = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { fetched += 1; return new Response("{}", { status: 200 }); };
  try {
    const result = await onRequestPost({ request: makeRequest({ url: CODE, titleId: "t1" }), env });
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, /URL invalide/);
    assert.equal(fetched, 0);
    assert.equal(calls.some((call) => /INSERT INTO catalog_media_sources/.test(call.sql)), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("l'import d'une URL Vidmoly .org conserve l'hôte et ne dépend pas de la clé Uqload", async () => {
  const { db, calls } = makeDb();
  const env = { DB: withDiscordAdminDb(db) };
  let fetched = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { fetched += 1; return new Response("{}", { status: 200 }); };
  try {
    const url = `https://vidmoly.org/embed-${CODE}.html`;
    const result = await onRequestPost({ request: makeRequest({ url, titleId: "t1" }), env });
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(body.provider, "vidmoly");
    assert.equal(body.playbackUrl, url);
    assert.equal(body.encodingStatus, "ready");
    assert.equal(fetched, 0, "Vidmoly must not call the Uqload API");

    const insert = calls.find((call) => /INSERT INTO catalog_media_sources/.test(call.sql));
    assert.equal(insert.values[3], "vidmoly");
    assert.equal(insert.values[6], url);
  } finally {
    globalThis.fetch = original;
  }
});

test("un refus de l'API Uqload n'écrit aucune source", async () => {
  const { db, calls } = makeDb();
  const env = { DB: withDiscordAdminDb(db), UQLOAD_API_KEY: "unit-test-key" };
  const { result } = await withUqloadFetch(
    { status: 400, error: "bad key" },
    () => onRequestPost({ request: makeRequest({ url: `https://uqload.vc/embed-${CODE}.html`, titleId: "t1" }), env }),
  );
  assert.equal(result.status, 502);
  assert.equal(calls.some((call) => /INSERT INTO catalog_media_sources/.test(call.sql)), false);
});
\n\ntest("une source déjà associée à un autre contenu est refusée sans écriture", async () => {\n  const { db, calls } = makeDb({ existingSource: { id: "source-1", title_id: "other-title", episode_id: null } });\n  const env = { DB: withDiscordAdminDb(db), UQLOAD_API_KEY: "unit-test-key" };\n  const { result } = await withUqloadFetch({ status: 200, result: [{ canplay: 1 }] }, () => onRequestPost({ request: makeRequest({ url: "https://uqload.vc/embed-" + CODE + ".html", titleId: "t1" }), env }));\n  assert.equal(result.status, 409);\n  const body = await result.json();\n  assert.equal(body.code, "SOURCE_ALREADY_ASSOCIATED");\n  assert.equal(body.existingTitleId, "other-title");\n  assert.equal(calls.some((call) => /INSERT INTO catalog_media_sources/.test(call.sql)), false);\n});\n\ntest("une source déjà liée au même contenu peut être actualisée", async () => {\n  const { db, calls } = makeDb({ existingSource: { id: "source-1", title_id: "t1", episode_id: null } });\n  const env = { DB: withDiscordAdminDb(db), UQLOAD_API_KEY: "unit-test-key" };\n  const { result } = await withUqloadFetch({ status: 200, result: [{ canplay: 1 }] }, () => onRequestPost({ request: makeRequest({ url: "https://uqload.vc/embed-" + CODE + ".html", titleId: "t1" }), env }));\n  assert.equal(result.status, 200);\n  assert.equal(calls.some((call) => /INSERT INTO catalog_media_sources/.test(call.sql)), true);\n});\n