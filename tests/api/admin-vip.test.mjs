import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost, onRequestDelete, onRequestGet } from "../../functions/api/admin/vip.ts";
import { ADMIN_ENV, discordAdminHeaders, withDiscordAdminDb } from "./helpers/admin-auth.mjs";

function makeEnv({ user = true, writeChanges = 1, stored = true } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) { call.values = values; return this; },
        async all() {
          if (/SELECT id FROM users/.test(sql)) return { success: true, results: user ? [{ id: "vip-user" }] : [] };
          if (/SELECT expires_at FROM vip_memberships/.test(sql)) return { success: true, results: stored ? [{ expires_at: "2030-01-01T00:00:00.000Z" }] : [] };
          if (/SELECT user_id FROM vip_memberships/.test(sql)) return { success: true, results: [] };
          if (/SELECT v\.user_id AS userId/.test(sql)) return { success: true, results: [] };
          throw new Error("Unexpected query: " + sql);
        },
        async run() { return { success: true, meta: { changes: writeChanges } }; },
      };
    },
  };
  return { env: { ...ADMIN_ENV, DB: withDiscordAdminDb(db) }, calls };
}

function request(method, body, { authenticated = true } = {}) {
  return new Request("https://cinebox.test/api/admin/vip", {
    method,
    headers: {
      ...discordAdminHeaders({ authenticated }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("VIP grant refuses unauthenticated callers before touching D1", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestPost({ request: request("POST", { userId: "vip-user", expiresAt: "2030-01-01T00:00:00.000Z" }, { authenticated: false }), env });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("VIP grant validates account existence and writes a normalized future expiry", async () => {
  const { env, calls } = makeEnv();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const response = await onRequestPost({ request: request("POST", { userId: "vip-user", expiresAt }), env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).updated, true);
  const write = calls.find(call => /INSERT INTO vip_memberships/.test(call.sql));
  assert.deepEqual(write.values, ["vip-user", expiresAt]);
});

test("VIP grant rejects unknown users and invalid dates without writing", async () => {
  const unknown = makeEnv({ user: false });
  const missing = await onRequestPost({ request: request("POST", { userId: "missing", expiresAt: "2030-01-01T00:00:00.000Z" }), env: unknown.env });
  assert.equal(missing.status, 404);
  assert.equal(unknown.calls.some(call => /INSERT INTO vip_memberships/.test(call.sql)), false);

  const invalid = makeEnv();
  const badDate = await onRequestPost({ request: request("POST", { userId: "vip-user", expiresAt: "yesterday" }), env: invalid.env });
  assert.equal(badDate.status, 400);
  assert.equal(invalid.calls.length, 0);
});

test("VIP revoke is authenticated and verifies the membership is gone", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestDelete({ request: request("DELETE", { userId: "vip-user" }), env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revoked: true, userId: "vip-user" });
  assert.ok(calls.some(call => /DELETE FROM vip_memberships/.test(call.sql)));
});

test("VIP list requires an administrator session", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequestGet({ request: request("GET", undefined, { authenticated: false }), env });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});
