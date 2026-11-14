import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../../functions/api/admin/vip-audit.ts";
import { ADMIN_ENV, discordAdminHeaders, withDiscordAdminDb } from "./helpers/admin-auth.mjs";

function makeEnv(titles) {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) { call.values = values; return this; },
        async all() {
          if (/SELECT id,title,published,vip_exclusive,vip_early_access,public_at FROM catalog_titles/.test(sql)) {
            return { success: true, results: titles };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        async first() { return null; },
        async run() { return { success: true }; },
      };
    },
  };
  return { env: { ...ADMIN_ENV, DB: withDiscordAdminDb(db) }, calls };
}

function get(headers = discordAdminHeaders()) {
  return new Request("https://cinebox.test/api/admin/vip-audit", { headers });
}

test("the VIP audit requires an administrator session", async () => {
  const { env, calls } = makeEnv([]);
  const response = await onRequestGet({ request: get(discordAdminHeaders({ authenticated: false })), env });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("the VIP audit reports every contradiction without writing anything", async () => {
  const { env, calls } = makeEnv([
    { id: "a", title: "Valide", published: 1, vip_exclusive: 1, vip_early_access: 0, public_at: null },
    { id: "b", title: "Contradictoire", published: 1, vip_exclusive: 1, vip_early_access: 1, public_at: null },
    { id: "c", title: "Sans date", published: 1, vip_exclusive: 0, vip_early_access: 1, public_at: null },
    { id: "d", title: "Date illisible", published: 1, vip_exclusive: 0, vip_early_access: 1, public_at: "hier" },
    { id: "e", title: "Exclusif avec date", published: 1, vip_exclusive: 1, vip_early_access: 0, public_at: "2026-01-01T00:00:00.000Z" },
    { id: "f", title: "Masqué VIP", published: 0, vip_exclusive: 1, vip_early_access: 0, public_at: null },
  ]);
  const response = await onRequestGet({ request: get(), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.checked, 6);
  assert.equal(body.readOnly, true);
  assert.equal(body.inconsistent, 5);
  const codes = new Set(body.issues.map((issue) => issue.code));
  assert.deepEqual([...codes].sort(), ["early-invalid-date", "early-without-date", "exclusive-and-early", "exclusive-with-date", "hidden-vip"]);
  assert.equal(calls.some((call) => /UPDATE|DELETE|INSERT/.test(call.sql)), false, "the audit must be read-only");
});

test("a consistent catalogue reports no issue", async () => {
  const { env } = makeEnv([
    { id: "a", title: "Public", published: 1, vip_exclusive: 0, vip_early_access: 0, public_at: null },
    { id: "b", title: "VIP", published: 1, vip_exclusive: 1, vip_early_access: 0, public_at: null },
    { id: "c", title: "Avant-première", published: 1, vip_exclusive: 0, vip_early_access: 1, public_at: "2026-01-01T00:00:00.000Z" },
  ]);
  const response = await onRequestGet({ request: get(), env });
  const body = await response.json();
  assert.equal(body.checked, 3);
  assert.equal(body.inconsistent, 0);
  assert.deepEqual(body.issues, []);
});
