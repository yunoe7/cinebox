import test from "node:test";
import assert from "node:assert/strict";
import { createAccountSession } from "../../functions/_lib/account-auth.ts";

function envWithRunResult(result) {
  return {
    DB: {
      prepare(query) {
        assert.match(query, /INSERT INTO account_sessions/);
        return { bind() { return this; }, async run() { return result; } };
      },
    },
  };
}

test("account session creation fails when D1 reports an unsuccessful insert", async () => {
  await assert.rejects(
    createAccountSession(new Request("https://cinebox.test/"), envWithRunResult({ success: false }), "user-1"),
    /Account session creation failed/,
  );
});

test("account session cookie is returned after a successful insert", async () => {
  const session = await createAccountSession(
    new Request("https://cinebox.test/"),
    envWithRunResult({ success: true }),
    "user-1",
  );
  assert.match(session.cookie, /^__Host-cinebox_session=/);
  assert.match(session.cookie, /HttpOnly/);
  assert.match(session.cookie, /Secure/);
  assert.ok(Number.isFinite(Date.parse(session.expiresAt)));
});
