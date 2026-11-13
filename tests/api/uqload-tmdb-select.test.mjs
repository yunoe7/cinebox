import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/uqload/tmdb-select.ts";
import { withDiscordAdminDb, discordAdminHeaders } from "./helpers/admin-auth.mjs";

const CODE = "abc123def456";

function makeDb() {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) { call.values = values; return this; },
        async all() { return { success: true, results: [] }; },
        async run() { return { success: true, meta: { changes: 1 } }; },
      };
    },
    batch: async () => [],
  };
  return { db, calls };
}

function makeRequest(body) {
  return new Request("https://cinebox.test/api/uqload/tmdb-select", {
    method: "POST",
    headers: { "content-type": "application/json", ...discordAdminHeaders() },
    body: JSON.stringify(body),
  });
}

async function withTmdbDetail(detail, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(detail), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function makeEnv(db) {
  return { DB: withDiscordAdminDb(db), TMDB_READ_ACCESS_TOKEN: "unit-test-tmdb-token" };
}

const MOVIE = { id: 123, title: "Film de test", overview: "", release_date: "2024-01-01", genres: [] };

test("l'association TMDB stocke l'URL uqload.vc et le statut canplay réel", async () => {
  const { db, calls } = makeDb();
  const result = await withTmdbDetail(MOVIE, () =>
    onRequestPost({
      request: makeRequest({ fileCode: CODE, fileTitle: "Film 2024", canplay: 0, tmdbId: 123, kind: "movie" }),
      env: makeEnv(db),
    }),
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.encodingStatus, "processing");

  const insert = calls.find((call) => /INSERT INTO catalog_media_sources/.test(call.sql));
  assert.ok(insert, "the media source must be inserted");
  assert.equal(insert.values[6], `https://uqload.vc/embed-${CODE}.html`);
  assert.equal(insert.values[8], "processing");
  // A re-association without a known canplay must not downgrade a known status.
  assert.match(insert.sql, /encoding_status=CASE WHEN excluded\.encoding_status='pending' THEN catalog_media_sources\.encoding_status ELSE excluded\.encoding_status END/);
});

test("sans canplay connu, l'association TMDB laisse la source « pending »", async () => {
  const { db } = makeDb();
  const result = await withTmdbDetail(MOVIE, () =>
    onRequestPost({
      request: makeRequest({ fileCode: CODE, fileTitle: "Film 2024", tmdbId: 123, kind: "movie" }),
      env: makeEnv(db),
    }),
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).encodingStatus, "pending");
});

test("canplay=1 marque la source TMDB comme prête", async () => {
  const { db } = makeDb();
  const result = await withTmdbDetail(MOVIE, () =>
    onRequestPost({
      request: makeRequest({ fileCode: CODE, fileTitle: "Film 2024", canplay: 1, tmdbId: 123, kind: "movie" }),
      env: makeEnv(db),
    }),
  );
  assert.equal((await result.json()).encodingStatus, "ready");
});
