import test from "node:test";
import assert from "node:assert/strict";
import { onRequestDelete } from "../../functions/api/catalog/manage.ts";
import { ADMIN_ENV, discordAdminHeaders, withDiscordAdminDb } from "./helpers/admin-auth.mjs";

function makeRequest(body) {
  return new Request("https://cinebox.test/api/catalog/manage", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...discordAdminHeaders() },
    body: JSON.stringify(body),
  });
}

test("catalog deletion rejects a non-boolean permanent flag before touching D1", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(sql);
      throw new Error("D1 must not be reached");
    },
  };
  for (const permanent of ["true", 1, null, {}]) {
    const response = await onRequestDelete({
      request: makeRequest({ id: "tmdb:movie:42", permanent }),
      env: { ...ADMIN_ENV, DB: withDiscordAdminDb(db) },
    });
    assert.equal(response.status, 400, JSON.stringify(permanent));
    assert.deepEqual(await response.json(), { error: "Le champ permanent doit être booléen." });
  }
  assert.deepEqual(calls, []);
});
