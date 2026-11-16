import test from "node:test";
import assert from "node:assert/strict";
import { getAccount } from "../../functions/_lib/account-auth.ts";

function mockEnv() {
  const calls = [];
  const DB = {
    prepare(sql) {
      calls.push({ sql });
      return {
        bind(...values) {
          calls[calls.length - 1].values = values;
          return this;
        },
        async run() {
          calls[calls.length - 1].ran = true;
          return { success: true };
        },
        async first() {
          calls[calls.length - 1].read = true;
          return null;
        },
      };
    },
  };
  return { env: { DB }, calls };
}

test("does not run session cleanup for requests without an account cookie", async () => {
  const { env, calls } = mockEnv();
  const result = await getAccount(new Request("https://cinebox.test/api/me"), env);
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test("prunes expired and revoked sessions when validating an account cookie", async () => {
  const { env, calls } = mockEnv();
  const request = new Request("https://cinebox.test/api/me", {
    headers: { cookie: " __Host-cinebox_session=valid-session-token" },
  });
  const result = await getAccount(request, env);
  assert.equal(result, null);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /DELETE FROM account_sessions WHERE expires_at<=\? OR revoked_at IS NOT NULL/);
  assert.equal(calls[0].ran, true);
  assert.match(calls[1].sql, /FROM account_sessions s JOIN users u/);
  assert.equal(calls[1].read, true);
});
