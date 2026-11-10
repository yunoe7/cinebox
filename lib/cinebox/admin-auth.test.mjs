import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_CSRF_HEADER,
  ADMIN_PASSWORD_ITERATIONS_DEFAULT,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_DEV,
  ADMIN_SESSION_TTL_SECONDS,
  buildClearSessionCookie,
  buildSessionCookie,
  createAdminSession,
  hashAdminPassword,
  parsePasswordHash,
  readCookie,
  requiresCsrf,
  sessionCookieName,
  verifyAdminPassword,
  verifyAdminSession,
  verifyRequestOrigin,
} from "./admin-auth.mjs";

const PASSWORD = "correct horse battery staple";
const SECRET = "unit-test-session-secret-that-is-long-enough-123";
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

function request(url, method = "GET", headers = {}) {
  return new Request(url, { method, headers });
}

test("PBKDF2 hashes verify the right password and reject the wrong one", async () => {
  const encoded = await hashAdminPassword(PASSWORD, { iterations: 100_000 });
  assert.match(encoded, /^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyAdminPassword(PASSWORD, encoded), true);
  assert.equal(await verifyAdminPassword("wrong password", encoded), false);
  assert.equal(await verifyAdminPassword("", encoded), false);
});

test("PBKDF2 uses a fresh salt for each hash", async () => {
  const first = await hashAdminPassword(PASSWORD, { iterations: 100_000 });
  const second = await hashAdminPassword(PASSWORD, { iterations: 100_000 });
  assert.notEqual(first, second);
  assert.equal(await verifyAdminPassword(PASSWORD, first), true);
  assert.equal(await verifyAdminPassword(PASSWORD, second), true);
});

test("password hash parsing rejects weak, malformed and out-of-range verifiers", () => {
  assert.equal(parsePasswordHash(""), null);
  assert.equal(parsePasswordHash(null), null);
  assert.equal(parsePasswordHash("pbkdf2-sha256$1000$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA"), null);
  assert.equal(parsePasswordHash("pbkdf2-sha256$100000$short$aGFzaA"), null);
  assert.equal(parsePasswordHash("bcrypt$100000$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA"), null);
  assert.equal(parsePasswordHash("pbkdf2-sha256$100000$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA"), null);
});

test("the default PBKDF2 cost stays inside the accepted range", () => {
  assert.ok(ADMIN_PASSWORD_ITERATIONS_DEFAULT >= 100_000);
  assert.ok(ADMIN_PASSWORD_ITERATIONS_DEFAULT <= 1_000_000);
});

test("a signed session round-trips and exposes its expiry", async () => {
  const session = await createAdminSession({ secret: SECRET, now: NOW, ttlSeconds: 3600 });
  assert.equal(session.issuedAt, NOW);
  assert.equal(session.expiresAt, NOW + 3600 * 1000);
  const verified = await verifyAdminSession(session.token, { secret: SECRET, now: NOW + 1000 });
  assert.equal(verified.valid, true);
  assert.equal(verified.expiresAt, session.expiresAt);
});

test("sessions cannot exceed the 12-hour maximum", async () => {
  await assert.rejects(
    () => createAdminSession({ secret: SECRET, now: NOW, ttlSeconds: ADMIN_SESSION_TTL_SECONDS + 1 }),
    RangeError,
  );
});

test("an expired session is rejected", async () => {
  const session = await createAdminSession({ secret: SECRET, now: NOW, ttlSeconds: 60 });
  const verified = await verifyAdminSession(session.token, { secret: SECRET, now: NOW + 61_000 });
  assert.equal(verified.valid, false);
  assert.equal(verified.reason, "expired");
});

test("a tampered payload or signature is rejected", async () => {
  const session = await createAdminSession({ secret: SECRET, now: NOW, ttlSeconds: 3600 });
  const [payload, signature] = session.token.split(".");
  const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}.${signature}`;
  const tamperedSignature = `${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
  assert.equal((await verifyAdminSession(tamperedPayload, { secret: SECRET, now: NOW })).valid, false);
  assert.equal((await verifyAdminSession(tamperedSignature, { secret: SECRET, now: NOW })).valid, false);
  assert.equal((await verifyAdminSession(session.token, { secret: `${SECRET}-other`, now: NOW })).valid, false);
  assert.equal((await verifyAdminSession("not-a-session", { secret: SECRET, now: NOW })).valid, false);
});

test("a session issued in the future is rejected", async () => {
  const session = await createAdminSession({ secret: SECRET, now: NOW + 120_000, ttlSeconds: 3600 });
  const verified = await verifyAdminSession(session.token, { secret: SECRET, now: NOW });
  assert.equal(verified.valid, false);
  assert.equal(verified.reason, "not-yet-valid");
});

test("cookie names and attributes follow the __Host- contract on HTTPS", () => {
  assert.equal(sessionCookieName({ secure: true }), ADMIN_SESSION_COOKIE);
  assert.equal(sessionCookieName({ secure: false }), ADMIN_SESSION_COOKIE_DEV);

  const cookie = buildSessionCookie("token-value", { secure: true, maxAge: 3600 });
  assert.match(cookie, new RegExp(`^${ADMIN_SESSION_COOKIE}=token-value;`));
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=3600/);
  assert.match(cookie, /Secure/);

  const devCookie = buildSessionCookie("token-value", { secure: false, maxAge: 3600 });
  assert.match(devCookie, new RegExp(`^${ADMIN_SESSION_COOKIE_DEV}=token-value;`));
  assert.doesNotMatch(devCookie, /Secure/);
});

test("clearing the cookie uses Max-Age=0 and the same name", () => {
  const cookie = buildClearSessionCookie({ secure: true });
  assert.match(cookie, new RegExp(`^${ADMIN_SESSION_COOKIE}=;`));
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test("readCookie finds the right cookie among unrelated values", () => {
  const header = "theme=dark; cinebox_admin=abc.def; other=1";
  assert.equal(readCookie(header, "cinebox_admin"), "abc.def");
  assert.equal(readCookie(header, "missing"), "");
  assert.equal(readCookie("", "cinebox_admin"), "");
  assert.equal(readCookie(null, "cinebox_admin"), "");
});

test("CSRF checks apply only to state-changing methods", () => {
  assert.equal(requiresCsrf("GET"), false);
  assert.equal(requiresCsrf("HEAD"), false);
  assert.equal(requiresCsrf("POST"), true);
  assert.equal(requiresCsrf("PATCH"), true);
  assert.equal(requiresCsrf("DELETE"), true);
  assert.deepEqual(verifyRequestOrigin(request("https://cinebox.test/api", "GET")), { ok: true });
});

test("state-changing requests need an exact Origin, same-origin fetch metadata and the custom header", () => {
  const base = "https://cinebox.test/api/auth/login";
  const valid = request(base, "POST", {
    origin: "https://cinebox.test",
    "sec-fetch-site": "same-origin",
    [ADMIN_CSRF_HEADER]: "1",
  });
  assert.deepEqual(verifyRequestOrigin(valid), { ok: true });

  const missingOrigin = request(base, "POST", { [ADMIN_CSRF_HEADER]: "1" });
  assert.equal(verifyRequestOrigin(missingOrigin).ok, false);

  const crossOrigin = request(base, "POST", {
    origin: "https://evil.test",
    [ADMIN_CSRF_HEADER]: "1",
  });
  assert.equal(verifyRequestOrigin(crossOrigin).ok, false);

  const crossSite = request(base, "POST", {
    origin: "https://cinebox.test",
    "sec-fetch-site": "cross-site",
    [ADMIN_CSRF_HEADER]: "1",
  });
  assert.equal(verifyRequestOrigin(crossSite).ok, false);

  const missingHeader = request(base, "POST", { origin: "https://cinebox.test" });
  assert.equal(verifyRequestOrigin(missingHeader).ok, false);
});
