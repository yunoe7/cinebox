import test from "node:test";
import assert from "node:assert/strict";
import {
  AdminAuthError,
  ADMIN_CSRF_HEADER,
  ADMIN_CSRF_VALUE,
  ADMIN_LOGIN_ENDPOINT,
  ADMIN_LOGOUT_ENDPOINT,
  ADMIN_SESSION_ENDPOINT,
  adminFetch,
  adminJson,
  getAdminSession,
  isAdminAuthError,
  loginAdmin,
  logoutAdmin,
} from "./admin-session.mjs";
import * as sessionModule from "./admin-session.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("the client module no longer exposes sessionStorage token helpers", () => {
  assert.equal(sessionModule.readAdminToken, undefined);
  assert.equal(sessionModule.writeAdminToken, undefined);
  assert.equal(sessionModule.clearAdminToken, undefined);
});

test("getAdminSession reads the cookie-backed server state", async () => {
  await withFetch(
    (url) => {
      assert.equal(url, ADMIN_SESSION_ENDPOINT);
      return jsonResponse({ authenticated: true, expiresAt: 123456 });
    },
    async (calls) => {
      const session = await getAdminSession();
      assert.deepEqual(session, { authenticated: true, expiresAt: 123456 });
      assert.equal(calls[0].init.credentials, "same-origin");
      assert.equal(calls[0].init.cache, "no-store");
      assert.equal(new Headers(calls[0].init.headers).get("authorization"), null);
    },
  );
});

test("getAdminSession degrades to anonymous when the API is unreachable", async () => {
  await withFetch(
    () => { throw new Error("offline"); },
    async () => {
      assert.deepEqual(await getAdminSession(), { authenticated: false, expiresAt: null });
    },
  );
});

test("loginAdmin posts the password with the CSRF header and no bearer token", async () => {
  await withFetch(
    (url) => {
      assert.equal(url, ADMIN_LOGIN_ENDPOINT);
      return jsonResponse({ authenticated: true, expiresAt: 999 });
    },
    async (calls) => {
      const session = await loginAdmin("correct horse battery staple");
      assert.deepEqual(session, { authenticated: true, expiresAt: 999 });
      const { init } = calls[0];
      assert.equal(init.method, "POST");
      assert.equal(init.credentials, "same-origin");
      const headers = new Headers(init.headers);
      assert.equal(headers.get(ADMIN_CSRF_HEADER), ADMIN_CSRF_VALUE);
      assert.equal(headers.get("authorization"), null);
      assert.deepEqual(JSON.parse(init.body), { password: "correct horse battery staple" });
    },
  );
});

test("loginAdmin surfaces the server error without leaking the password", async () => {
  await withFetch(
    () => jsonResponse({ error: "Mot de passe administrateur incorrect." }, 401),
    async () => {
      await assert.rejects(
        () => loginAdmin("wrong password"),
        (error) => {
          assert.ok(error instanceof AdminAuthError);
          assert.ok(isAdminAuthError(error));
          assert.equal(error.status, 401);
          assert.equal(error.message, "Mot de passe administrateur incorrect.");
          assert.equal(error.message.includes("wrong password"), false);
          return true;
        },
      );
    },
  );
});

test("logoutAdmin posts to the logout endpoint and tolerates network failures", async () => {
  await withFetch(
    (url, init) => {
      assert.equal(url, ADMIN_LOGOUT_ENDPOINT);
      assert.equal(init.method, "POST");
      assert.equal(new Headers(init.headers).get(ADMIN_CSRF_HEADER), ADMIN_CSRF_VALUE);
      return jsonResponse({ authenticated: false });
    },
    async () => {
      await assert.doesNotReject(() => logoutAdmin());
    },
  );
  await withFetch(
    () => { throw new Error("offline"); },
    async () => {
      await assert.doesNotReject(() => logoutAdmin());
    },
  );
});

test("adminJson sends the cookie and CSRF header, then parses the payload", async () => {
  await withFetch(
    (url, init) => {
      assert.equal(url, "/api/catalog/manage");
      assert.equal(init.credentials, "same-origin");
      assert.equal(new Headers(init.headers).get(ADMIN_CSRF_HEADER), ADMIN_CSRF_VALUE);
      assert.equal(new Headers(init.headers).get("authorization"), null);
      return jsonResponse({ titles: [] });
    },
    async () => {
      assert.deepEqual(await adminJson("/api/catalog/manage"), { titles: [] });
    },
  );
});

test("adminFetch turns a 401 into a typed AdminAuthError", async () => {
  await withFetch(
    () => jsonResponse({ error: "Session administrateur expirée. Reconnecte-toi." }, 401),
    async () => {
      await assert.rejects(
        () => adminFetch("/api/bunny/videos"),
        (error) => {
          assert.ok(isAdminAuthError(error));
          assert.equal(error.status, 401);
          assert.match(error.message, /Session administrateur expirée/);
          return true;
        },
      );
    },
  );
});
