import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/uqload/[[path]].ts";
import { withDiscordAdminDb, discordAdminHeaders } from "./helpers/admin-auth.mjs";

const SERIES = { id: "tmdb:series:21541", kind: "series", title: "Black Clover", published: 0 };
const EPISODE = {
  id: "tmdb:series:21541:s1:e1",
  title_id: SERIES.id,
  title: "L'enfant qui voulait devenir l'Empereur-Mage",
  season_number: 1,
  episode_number: 1,
};

function makeDb() {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (/FROM catalog_titles WHERE/.test(sql) || /SELECT id,kind,title,published FROM catalog_titles/.test(sql)) {
            return { success: true, results: [SERIES] };
          }
          if (/FROM catalog_episodes/.test(sql)) return { success: true, results: [EPISODE] };
          return { success: true, results: [] };
        },
      };
    },
    batch: async () => [],
  };
}

function makeRequest() {
  return new Request("https://cinebox.test/api/uqload", { headers: discordAdminHeaders() });
}

test("sans UQLOAD_API_KEY, les cibles incluent une série non publiée et aucun appel Uqload n'est fait", async () => {
  const env = { DB: withDiscordAdminDb(makeDb()) };
  let fetched = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { fetched += 1; return new Response("{}", { status: 200 }); };
  try {
    const response = await onRequestGet({ request: makeRequest(), env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.configured, false);
    assert.equal(fetched, 0);
    assert.equal(body.targets.length, 1);
    assert.equal(body.targets[0].title, "Black Clover");
    assert.equal(body.targets[0].published, 0, "an unpublished title must stay selectable");
    assert.equal(body.targets[0].episodes[0].id, EPISODE.id);
    assert.deepEqual(body.files, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("une panne Uqload conserve les cibles D1 et les sources Vidmoly", async () => {
  const env = { DB: withDiscordAdminDb(makeDb()), UQLOAD_API_KEY: "unit-test-key" };
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Uqload indisponible"); };
  try {
    const response = await onRequestGet({ request: makeRequest(), env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.configured, true);
    assert.equal(body.targets[0].title, "Black Clover");
    assert.equal(body.upstreamError, "Uqload indisponible");
  } finally {
    globalThis.fetch = original;
  }
});
