import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as login } from "../../functions/api/auth/login.ts";
import { onRequestPost as logout } from "../../functions/api/auth/logout.ts";
import { onRequestGet as session } from "../../functions/api/auth/session.ts";
import { onRequestGet as discordCallback } from "../../functions/api/auth/discord/callback.ts";

const LOGIN_URL = "https://cinebox.test/api/auth/login";
const LOGOUT_URL = "https://cinebox.test/api/auth/logout";
const SESSION_URL = "https://cinebox.test/api/auth/session";

function legacyLoginRequest(body = { password: "legacy-admin-password" }) {
  return new Request(LOGIN_URL, {
    method: "POST",
    headers: { origin: "https://cinebox.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("legacy password login is permanently disabled and never issues a cookie", async () => {
  const response = await login({ request: legacyLoginRequest(), env: {} });
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    error: "La connexion par mot de passe est désactivée. Utilise Discord OAuth.",
  });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("legacy password login stays disabled for malformed and incorrect payloads", async () => {
  for (const body of [{}, { password: "wrong" }, { password: "x".repeat(2048) }]) {
    const response = await login({ request: legacyLoginRequest(body), env: {} });
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("legacy session endpoint always reports the retired password session as unavailable", async () => {
  const anonymous = await session({
    request: new Request(SESSION_URL),
    env: {},
  });
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), { authenticated: false, configured: false });

  const withLegacyCookie = await session({
    request: new Request(SESSION_URL, {
      headers: { cookie: "__Host-cinebox_admin=legacy-session-value" },
    }),
    env: {},
  });
  assert.equal(withLegacyCookie.status, 200);
  assert.deepEqual(await withLegacyCookie.json(), { authenticated: false, configured: false });
  assert.equal(withLegacyCookie.headers.get("set-cookie"), null);
});

test("legacy logout endpoint is a harmless no-op and does not manage the Discord account cookie", async () => {
  const response = await logout({
    request: new Request(LOGOUT_URL, { method: "POST" }),
    env: {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("legacy logout endpoint remains harmless for cross-origin requests", async () => {
  const response = await logout({
    request: new Request(LOGOUT_URL, {
      method: "POST",
      headers: { origin: "https://evil.test" },
    }),
    env: {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.equal(response.headers.get("set-cookie"), null);
});


test("Discord OAuth callback clears temporary cookies when the state is invalid", async () => {
  const response = await discordCallback({
    request: new Request("https://cinebox.test/api/auth/discord/callback?code=test-code&state=wrong-state", {
      headers: { cookie: "cinebox_discord_state=expected-state; cinebox_discord_mode=admin" },
    }),
    env: {},
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /erreur=discord-state/);
  const cookies = response.headers.get("set-cookie") || "";
  assert.match(cookies, /cinebox_discord_state=/);
  assert.match(cookies, /cinebox_discord_mode=/);
  assert.match(cookies, /Max-Age=0/);
});

test("Discord OAuth callback clears temporary cookies when server OAuth config is missing", async () => {
  const response = await discordCallback({
    request: new Request("https://cinebox.test/api/auth/discord/callback?code=test-code&state=expected-state", {
      headers: { cookie: "cinebox_discord_state=expected-state; cinebox_discord_mode=admin" },
    }),
    env: {},
  });
  assert.equal(response.status, 302);
  assert.match(response.headers.get("location"), /erreur=discord-config/);
  const cookies = response.headers.get("set-cookie") || "";
  assert.match(cookies, /cinebox_discord_state=/);
  assert.match(cookies, /cinebox_discord_mode=/);
  assert.match(cookies, /Max-Age=0/);
});
