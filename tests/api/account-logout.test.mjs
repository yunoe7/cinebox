import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/account/logout.ts";

function request() {
  return new Request("https://cinebox.test/api/account/logout", {
    method: "POST",
    headers: {
      origin: "https://cinebox.test",
      "sec-fetch-site": "same-origin",
      "x-cinebox-request": "1",
      cookie: "__Host-cinebox_session=valid-session-token",
    },
  });
}

function envWithRevocationResult(result) {
  const calls = [];
  return {
    env: {
      DB: {
        prepare(sql) {
          calls.push({ sql });
          return {
            bind(...values) {
              calls[calls.length - 1].values = values;
              return this;
            },
            async run() { return result; },
          };
        },
      },
    },
    calls,
  };
}

test("logout does not clear the cookie or report success when D1 revocation fails", async () => {
  const { env, calls } = envWithRevocationResult({ success: false });
  const response = await onRequestPost({ request: request(), env });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Déconnexion impossible." });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE account_sessions SET revoked_at/);
});

test("logout clears the account cookie after successful server-side revocation", async () => {
  const { env, calls } = envWithRevocationResult({ success: true });
  const response = await onRequestPost({ request: request(), env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/);
  assert.equal(calls.length, 1);
});
