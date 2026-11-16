import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/uqload/sync.ts";
import { withDiscordAdminDb, discordAdminHeaders } from "./helpers/admin-auth.mjs";

const CODE = "abc123def456";
const OTHER_CODE = "zzz999yyy888";

function makeDb({ existingCodes = [] } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) { call.values = values; return this; },
        async all() {
          // "already associated?" lookup used by createDraftAndAssociate.
          if (/SELECT id FROM catalog_media_sources WHERE provider='uqload' AND file_code=\?/.test(sql)) {
            const known = existingCodes.includes(call.values[0]);
            return { success: true, results: known ? [{ id: `src-${call.values[0]}` }] : [] };
          }
          // Reconciliation inventory of stored Uqload sources.
          if (/SELECT file_code FROM catalog_media_sources WHERE provider='uqload'$/.test(sql)) {
            return { success: true, results: existingCodes.map((code) => ({ file_code: code })) };
          }
          return { success: true, results: [] };
        },
        async run() { return { success: true, meta: { changes: 1 } }; },
      };
    },
    batch: async () => [],
  };
  return { db, calls };
}

function makeRequest() {
  return new Request("https://cinebox.test/api/uqload/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...discordAdminHeaders() },
    body: "{}",
  });
}

/** Replaces global fetch with a scripted Uqload `/file/list` response. */
async function withUqloadList(files, run, { metadata = true } = {}) {
  const original = globalThis.fetch;
  const requests = [];
  const result = metadata
    ? { files, pages: 1, results_total: files.length, results: files.length }
    : { files };
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ status: 200, result }), {
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

function makeEnv(db) {
  return {
    DB: withDiscordAdminDb(db),
    UQLOAD_API_KEY: "unit-test-key",
    TMDB_READ_ACCESS_TOKEN: "unit-test-tmdb-token",
  };
}

test("un inventaire distant vide ne supprime aucune source", async () => {
  const { db, calls } = makeDb({ existingCodes: [CODE, OTHER_CODE] });
  const { result } = await withUqloadList([], () =>
    onRequestPost({ request: makeRequest(), env: makeEnv(db) }),
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.deleted, 0);
  assert.equal(body.inventoryComplete, true);
  assert.match(body.deletionSkipped, /Inventaire distant vide/);
  assert.equal(calls.some((call) => /^DELETE FROM catalog_media_sources/.test(call.sql)), false);
  assert.equal(
    calls.some((call) => /SELECT file_code FROM catalog_media_sources WHERE provider='uqload'$/.test(call.sql)),
    false,
    "an empty inventory must not even read the stored inventory to reconcile",
  );
});

test("un inventaire sans fichier Uqload exploitable ne supprime rien non plus", async () => {
  const { db, calls } = makeDb({ existingCodes: [CODE] });
  // Files without a valid code cannot prove that the stored source is gone.
  const { result } = await withUqloadList([{ file_title: "Sans code" }], () =>
    onRequestPost({ request: makeRequest(), env: makeEnv(db) }),
  );
  const body = await result.json();
  assert.equal(body.deleted, 0);
  assert.equal(calls.some((call) => /^DELETE FROM catalog_media_sources/.test(call.sql)), false);
});

test("canplay=0 met à jour une source existante en « processing »", async () => {
  const { db, calls } = makeDb({ existingCodes: [CODE] });
  const { result } = await withUqloadList(
    [{ file_code: CODE, file_title: "Film 2024", canplay: 0, file_quality: "1080p" }],
    () => onRequestPost({ request: makeRequest(), env: makeEnv(db) }),
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.existing, 1);
  assert.equal(body.created, 0);

  const update = calls.find((call) => /^UPDATE catalog_media_sources SET encoding_status=/.test(call.sql));
  assert.ok(update, "the existing source must be refreshed, not ignored");
  assert.equal(update.values[0], "processing");
  assert.equal(update.values[3], CODE);
});

test("canplay=1 remet une source existante en « ready » après encodage", async () => {
  const { db, calls } = makeDb({ existingCodes: [CODE] });
  const { result } = await withUqloadList(
    [{ file_code: CODE, file_title: "Film 2024", canplay: 1 }],
    () => onRequestPost({ request: makeRequest(), env: makeEnv(db) }),
  );
  const body = await result.json();
  assert.equal(body.existing, 1);
  const update = calls.find((call) => /^UPDATE catalog_media_sources SET encoding_status=/.test(call.sql));
  assert.ok(update);
  assert.equal(update.values[0], "ready");
});

test("un canplay absent laisse le statut « pending » au lieu d'annoncer prêt", async () => {
  const { db, calls } = makeDb({ existingCodes: [CODE] });
  const { result } = await withUqloadList(
    [{ file_code: CODE, file_title: "Film 2024" }],
    () => onRequestPost({ request: makeRequest(), env: makeEnv(db) }),
  );
  const body = await result.json();
  assert.equal(body.existing, 1);
  const update = calls.find((call) => /^UPDATE catalog_media_sources SET encoding_status=/.test(call.sql));
  assert.ok(update);
  assert.equal(update.values[0], "pending");
});

test("une source réellement absente du compte complet est supprimée", async () => {
  const { db, calls } = makeDb({ existingCodes: [CODE, OTHER_CODE] });
  const { result } = await withUqloadList(
    [{ file_code: CODE, file_title: "Film 2024", canplay: 1 }],
    () => onRequestPost({ request: makeRequest(), env: makeEnv(db) }),
  );
  const body = await result.json();
  assert.equal(body.inventoryComplete, true);
  assert.equal(body.deleted, 1);
  assert.equal(body.deletionSkipped, null);
  const deletions = calls.filter((call) => /^DELETE FROM catalog_media_sources/.test(call.sql));
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0].values[0], OTHER_CODE);
});


test("des métadonnées de pagination absentes n'autorisent jamais les suppressions", async () => {
  const { db, calls } = makeDb({ existingCodes: [CODE, OTHER_CODE] });
  const { result } = await withUqloadList(
    [{ file_code: CODE, file_title: "Film 2024", canplay: 1 }],
    () => onRequestPost({ request: makeRequest(), env: makeEnv(db) }),
    { metadata: false },
  );
  const body = await result.json();
  assert.equal(body.inventoryComplete, false);
  assert.equal(body.deleted, 0);
  assert.match(body.deletionSkipped, /métadonnées pages\/results_total absentes/);
  assert.equal(calls.some((call) => /^DELETE FROM catalog_media_sources/.test(call.sql)), false);
});

test("un nombre de fichiers différent du total annoncé bloque la réconciliation", async () => {
  const { db, calls } = makeDb({ existingCodes: [CODE, OTHER_CODE] });
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: 200,
    result: { files: [{ file_code: CODE, file_title: "Film 2024", canplay: 1 }], pages: 1, results_total: 2, results: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const result = await onRequestPost({ request: makeRequest(), env: makeEnv(db) });
    const body = await result.json();
    assert.equal(body.inventoryComplete, false);
    assert.equal(body.deleted, 0);
    assert.match(body.deletionSkipped, /1 fichiers reçus sur 2 annoncés/);
    assert.equal(calls.some((call) => /^DELETE FROM catalog_media_sources/.test(call.sql)), false);
  } finally {
    globalThis.fetch = original;
  }
});
