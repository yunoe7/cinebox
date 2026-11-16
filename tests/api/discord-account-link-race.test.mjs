import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as discordCallback } from "../../functions/api/auth/discord/callback.ts";

test("Discord account linking rejects a concurrent ownership conflict without issuing a session", async () => {
  let sessionInsertCount = 0;
  let linkInsertSql = "";
  const env = {
    DISCORD_CLIENT_ID: "client-id",
    DISCORD_CLIENT_SECRET: "client-secret",
    DISCORD_REDIRECT_URI: "https://cinebox.test/api/auth/discord/callback",
    DB: {
      prepare(query) {
        const statement = {
          values: [],
          bind(...values) { this.values = values; return this; },
          async first() {
            if (query.includes("JOIN users")) {
              return { id: "current-user", display_name: "Current", role: "user", email: null, expires_at: "2099-01-01T00:00:00.000Z" };
            }
            if (query.includes("SELECT user_id FROM auth_identities")) return null;
            throw new Error("Unexpected first query: " + query);
          },
          async run() {
            if (query.includes("DELETE FROM account_sessions")) return { success: true, meta: { changes: 0 } };
            if (query.includes("INSERT INTO auth_identities")) {
              linkInsertSql = query;
              // Another account claimed this Discord identity after the pre-check.
              return { success: true, meta: { changes: 0 } };
            }
            if (query.includes("INSERT INTO account_sessions")) sessionInsertCount++;
            throw new Error("Unexpected run query: " + query);
          },
        };
        return statement;
      },
      async batch() { throw new Error("Unexpected batch"); },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/api/oauth2/token")) {
      return Response.json({ access_token: "oauth-token", token_type: "Bearer" });
    }
    if (url.includes("/api/users/@me")) {
      return Response.json({ id: "discord-user", username: "alice" });
    }
    throw new Error("Unexpected fetch: " + url);
  };

  try {
    const response = await discordCallback({
      request: new Request("https://cinebox.test/api/auth/discord/callback?code=oauth-code&state=expected-state", {
        headers: {
          cookie: "__Host-cinebox_session=existing-session; cinebox_discord_state=expected-state; cinebox_discord_mode=link",
        },
      }),
      env,
    });

    assert.equal(response.status, 302);
    assert.match(response.headers.get("location"), /erreur=discord-already-linked/);
    assert.match(linkInsertSql, /WHERE auth_identities\.user_id=excluded\.user_id/);
    assert.equal(sessionInsertCount, 0);
    assert.doesNotMatch(response.headers.get("set-cookie") || "", /__Host-cinebox_session=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
