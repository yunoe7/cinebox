import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost as login } from "../../functions/api/auth/login.ts";
import { onRequestPost as logout } from "../../functions/api/auth/logout.ts";
import { onRequestGet as session } from "../../functions/api/auth/session.ts";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
} from "../../lib/cinebox/admin-auth.mjs";
import {
  ADMIN_ENV,
  ADMIN_PASSWORD,
  ADMIN_SESSION_SECRET,
  adminHeaders,
  createAdminCookie,
} from "./helpers/admin-auth.mjs";

const LOGIN_URL = "https://cinebox.test/api/auth/login";
const LOGOUT_URL = "https://cinebox.test/api/auth/logout";
const SESSION_URL = "https://cinebox.test/api/auth/session";

function loginRequest({
  password = ADMIN_PASSWORD,
  body,
  origin = "https://cinebox.test",
  csrf = true,
} = {}) {
  return new Request(LOGIN_URL, {
    method: "POST",
    headers: {
      ...adminHeaders({ authenticated: false, origin, csrf }),
      "content-type": "application/json",
    },
    body: body === undefined ? JSON.stringify({ password }) : body,
  });
}

function sessionRequest({ cookie, extra = {} } = {}) {
  const headers = { ...adminHeaders({ authenticated: false }), ...extra };
  if (cookie) headers.cookie = cookie;
  return new Request(SESSION_URL, { headers });
}

function logoutRequest({ csrf = true, origin = "https://cinebox.test" } = {}) {
  return new Request(LOGOUT_URL, {
    method: "POST",
    headers: adminHeaders({ authenticated: false, csrf, origin }),
  });
}

function cookiePair(setCookie) {
  assert.ok(setCookie, "a Set-Cookie header is expected");
  return setCookie.split(";")[0];
}

test("login verifies the password and sets a hardened __Host- cookie", async () => {
  const response = await login({ request: loginRequest(), env: ADMIN_ENV });
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(typeof body.expiresAt, "number");
  assert.ok(body.expiresAt > Date.now());
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("pbkdf2"), false);
  assert.equal(serialized.includes(ADMIN_SESSION_SECRET), false);
  assert.equal(serialized.includes(ADMIN_PASSWORD), false);

  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie.startsWith(`${ADMIN_SESSION_COOKIE}=`));
  assert.match(setCookie, /; Path=\//);
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; SameSite=Strict/);
  assert.match(setCookie, /; Secure/);
  assert.match(setCookie, new RegExp(`; Max-Age=${ADMIN_SESSION_TTL_SECONDS}`));
  assert.equal(setCookie.includes("Domain="), false);
});

test("a cookie issued by login authenticates the session endpoint", async () => {
  const loginResponse = await login({ request: loginRequest(), env: ADMIN_ENV });
  const cookie = cookiePair(loginResponse.headers.get("set-cookie"));

  const sessionResponse = await session({
    request: sessionRequest({ cookie }),
    env: ADMIN_ENV,
  });
  assert.equal(sessionResponse.status, 200);
  const body = await sessionResponse.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.configured, true);
  assert.equal(typeof body.expiresAt, "number");
  assert.equal(JSON.stringify(body).includes(cookie.split("=")[1]), false);
});

test("login rejects a wrong password without setting a cookie", async () => {
  const response = await login({
    request: loginRequest({ password: "this is not the password" }),
    env: ADMIN_ENV,
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Mot de passe administrateur incorrect." });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("login rejects malformed payloads", async () => {
  const missing = await login({ request: loginRequest({ body: JSON.stringify({}) }), env: ADMIN_ENV });
  assert.equal(missing.status, 400);

  const invalidJson = await login({ request: loginRequest({ body: "{" }), env: ADMIN_ENV });
  assert.equal(invalidJson.status, 400);

  const tooLong = await login({
    request: loginRequest({ body: JSON.stringify({ password: "x".repeat(1025) }) }),
    env: ADMIN_ENV,
  });
  assert.equal(tooLong.status, 400);
});

test("login is protected by the CSRF checks", async () => {
  const crossOrigin = await login({
    request: loginRequest({ origin: "https://evil.test" }),
    env: ADMIN_ENV,
  });
  assert.equal(crossOrigin.status, 403);

  const missingHeader = await login({
    request: loginRequest({ csrf: false }),
    env: ADMIN_ENV,
  });
  assert.equal(missingHeader.status, 403);
});

test("login reports a server configuration error", async () => {
  const response = await login({
    request: loginRequest(),
    env: { ...ADMIN_ENV, CINEBOX_SESSION_SECRET: undefined },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "L'administration n'est pas configurée côté serveur." });
});

test("session reports anonymous when no cookie is present", async () => {
  const response = await session({ request: sessionRequest(), env: ADMIN_ENV });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false, configured: true });
});

test("session clears a tampered cookie", async () => {
  const response = await session({
    request: sessionRequest({ cookie: `${ADMIN_SESSION_COOKIE}=not-a-signed-session` }),
    env: ADMIN_ENV,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false, configured: true });
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie.startsWith(`${ADMIN_SESSION_COOKIE}=;`));
  assert.match(setCookie, /Max-Age=0/);
});

test("session clears an expired cookie", async () => {
  const cookie = await createAdminCookie({
    now: Date.now() - 10 * 60 * 1000,
    ttlSeconds: 60,
  });
  const response = await session({ request: sessionRequest({ cookie }), env: ADMIN_ENV });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authenticated, false);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("session reports an unconfigured server without throwing", async () => {
  const response = await session({
    request: sessionRequest(),
    env: { ...ADMIN_ENV, CINEBOX_ADMIN_PASSWORD_HASH: undefined },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false, configured: false });
});

test("logout clears the cookie with Max-Age=0", async () => {
  const response = await logout({ request: logoutRequest() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie.startsWith(`${ADMIN_SESSION_COOKIE}=;`));
  assert.match(setCookie, /Max-Age=0/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
});

test("logout rejects a cross-origin request", async () => {
  const response = await logout({
    request: logoutRequest({ origin: "https://evil.test" }),
  });
  assert.equal(response.status, 403);
});
