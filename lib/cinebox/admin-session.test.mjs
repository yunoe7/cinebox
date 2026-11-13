import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_CSRF_HEADER, ADMIN_CSRF_VALUE, ADMIN_LOGOUT_ENDPOINT, ADMIN_SESSION_ENDPOINT, adminFetch, adminJson, getAdminSession, isAdminAuthError, loginAdmin, logoutAdmin } from "./admin-session.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
async function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => { calls.push({ url: String(input), init }); return handler(String(input), init); };
  globalThis.window = { location: { assign: (url) => calls.push({ redirect: url }) } };
  try { await run(calls); } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
}

test("getAdminSession requires an authenticated Discord admin account", async () => {
  await withFetch(url => {
    assert.equal(url, ADMIN_SESSION_ENDPOINT);
    return jsonResponse({ authenticated: true, user: { isAdmin: true } });
  }, async calls => {
    assert.deepEqual(await getAdminSession(), { authenticated: true, expiresAt: null });
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.equal(calls[0].init.cache, "no-store");
  });
  await withFetch(() => jsonResponse({ authenticated: true, user: { isAdmin: false } }), async () => {
    assert.deepEqual(await getAdminSession(), { authenticated: false, expiresAt: null });
  });
});

test("loginAdmin starts Discord OAuth without requesting a password", async () => {
  await withFetch(() => jsonResponse({}), async calls => {
    await loginAdmin();
    assert.deepEqual(calls[0], { redirect: "/api/auth/discord/start?mode=admin" });
  });
});

test("logoutAdmin clears the Discord account session and redirects", async () => {
  await withFetch((url, init) => {
    assert.equal(url, ADMIN_LOGOUT_ENDPOINT);
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get(ADMIN_CSRF_HEADER), ADMIN_CSRF_VALUE);
    return jsonResponse({ authenticated: false });
  }, async calls => {
    await logoutAdmin();
    assert.equal(calls.at(-1).redirect, "/connexion");
  });
});

test("adminJson sends the cookie and CSRF header, then parses payload", async () => {
  await withFetch((url, init) => {
    assert.equal(url, "/api/catalog/manage");
    assert.equal(init.credentials, "same-origin");
    assert.equal(new Headers(init.headers).get(ADMIN_CSRF_HEADER), ADMIN_CSRF_VALUE);
    return jsonResponse({ titles: [] });
  }, async () => {
    assert.deepEqual(await adminJson("/api/catalog/manage"), { titles: [] });
  });
});

test("adminFetch turns a 401 into a typed AdminAuthError", async () => {
  await withFetch(() => jsonResponse({ error: "Session Discord expirée." }, 401), async () => {
    await assert.rejects(() => adminFetch("/api/catalog/manage"), error => {
      assert.equal(isAdminAuthError(error), true);
      assert.equal(error.status, 401);
      return true;
    });
  });
});
