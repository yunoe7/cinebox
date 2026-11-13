import { expect, test, type APIRequestContext } from "@playwright/test";
import { TEST_ADMIN_PASSWORD, TEST_ORIGIN } from "./test-config.mjs";

const LOGIN = "/api/auth/login";
const LOGOUT = "/api/auth/logout";
const SESSION = "/api/auth/session";
const ADMIN_ROUTE = "/api/catalog/manage";
const CSRF = { "x-cinebox-request": "1" };

function mutationHeaders(overrides: Record<string, string> = {}) {
  return {
    origin: TEST_ORIGIN,
    "sec-fetch-site": "same-origin",
    ...CSRF,
    ...overrides,
  };
}

function setCookieHeaders(response: { headersArray(): { name: string; value: string }[] }) {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);
}

async function login(request: APIRequestContext) {
  return request.post(LOGIN, {
    headers: mutationHeaders(),
    data: { password: TEST_ADMIN_PASSWORD },
  });
}

test("l'API réelle n'accepte pas les anciens jetons admin sans session Discord et D1", async ({ request }) => {
  const anonymous = await request.get(SESSION);
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.json()).toEqual({ authenticated: false, configured: true });

  const denied = await request.get(ADMIN_ROUTE);
  expect(denied.status()).toBe(503);
  expect(await denied.json()).toEqual({ error: "La connexion Discord ou la base de données administrateur n’est pas configurée." });

  const legacyBearer = await request.get(ADMIN_ROUTE, {
    headers: { authorization: "Bearer legacy-admin-token-that-is-long-enough" },
  });
  expect(legacyBearer.status()).toBe(503);
  expect(await legacyBearer.json()).toEqual({ error: "La connexion Discord ou la base de données administrateur n’est pas configurée." });

  const wrongPassword = await request.post(LOGIN, {
    headers: mutationHeaders(),
    data: { password: "this is not the admin password" },
  });
  expect(wrongPassword.status()).toBe(401);
  expect(await wrongPassword.json()).toEqual({ error: "Mot de passe administrateur incorrect." });
  expect(setCookieHeaders(wrongPassword)).toEqual([]);
});

test("l'API réelle bloque les requêtes sans en-tête CSRF ou d'origine étrangère", async ({ request }) => {
  const withoutCsrf = await request.post(LOGIN, {
    headers: { origin: TEST_ORIGIN, "sec-fetch-site": "same-origin" },
    data: { password: TEST_ADMIN_PASSWORD },
  });
  expect(withoutCsrf.status()).toBe(403);
  expect(await withoutCsrf.json()).toEqual({ error: "Requête refusée : origine invalide." });

  const foreignOrigin = await request.post(LOGIN, {
    headers: mutationHeaders({ origin: "https://evil.test" }),
    data: { password: TEST_ADMIN_PASSWORD },
  });
  expect(foreignOrigin.status()).toBe(403);
  expect(setCookieHeaders(foreignOrigin)).toEqual([]);
});

test("la connexion pose un cookie __Host- durci et la session est consultable", async ({ request }) => {
  const response = await login(request);
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body.authenticated).toBe(true);
  expect(typeof body.expiresAt).toBe("number");
  expect(body.expiresAt).toBeGreaterThan(Date.now());
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain(TEST_ADMIN_PASSWORD);
  expect(serialized).not.toContain("pbkdf2");

  const cookies = setCookieHeaders(response);
  expect(cookies).toHaveLength(1);
  const cookie = cookies[0];
  expect(cookie.startsWith("__Host-cinebox_admin=")).toBe(true);
  expect(cookie).toMatch(/; Path=\//);
  expect(cookie).toMatch(/; HttpOnly/);
  expect(cookie).toMatch(/; SameSite=Strict/);
  expect(cookie).toMatch(/; Secure/);
  expect(cookie).toMatch(/; Max-Age=43200/);
  expect(cookie).not.toContain("Domain=");

  const state = await request.storageState();
  const stored = state.cookies.find((entry) => entry.name === "__Host-cinebox_admin");
  expect(stored).toBeDefined();
  expect(stored?.httpOnly).toBe(true);
  expect(stored?.secure).toBe(true);
  expect(stored?.sameSite).toBe("Strict");
  expect(stored?.path).toBe("/");

  const session = await request.get(SESSION);
  expect(session.status()).toBe(200);
  const sessionBody = await session.json();
  expect(sessionBody.authenticated).toBe(true);
  expect(sessionBody.configured).toBe(true);
  expect(sessionBody.expiresAt).toBeGreaterThan(Date.now());

  // The real Functions runtime accepts the cookie. D1 is intentionally not
  // bound here, so reaching the 503 proves the auth guard was passed.
  const adminRoute = await request.get(ADMIN_ROUTE);
  expect(adminRoute.status()).toBe(503);
  expect(await adminRoute.json()).toEqual({
    error: "Base de données indisponible.",
  });
});

test("la déconnexion efface le cookie et coupe l'accès", async ({ request }) => {
  expect((await login(request)).status()).toBe(200);

  const withoutCsrf = await request.post(LOGOUT, {
    headers: { origin: TEST_ORIGIN, "sec-fetch-site": "same-origin" },
  });
  expect(withoutCsrf.status()).toBe(403);
  expect((await request.get(ADMIN_ROUTE)).status()).toBe(503);

  const logout = await request.post(LOGOUT, { headers: mutationHeaders() });
  expect(logout.status()).toBe(200);
  expect(await logout.json()).toEqual({ authenticated: false });

  const cleared = setCookieHeaders(logout);
  expect(cleared).toHaveLength(1);
  expect(cleared[0].startsWith("__Host-cinebox_admin=;")).toBe(true);
  expect(cleared[0]).toMatch(/Max-Age=0/);
  expect(cleared[0]).toMatch(/HttpOnly/);
  expect(cleared[0]).toMatch(/SameSite=Strict/);
  expect(cleared[0]).toMatch(/Secure/);

  const state = await request.storageState();
  expect(state.cookies.find((entry) => entry.name === "__Host-cinebox_admin")).toBeUndefined();

  const session = await request.get(SESSION);
  expect(await session.json()).toEqual({ authenticated: false, configured: true });
  expect((await request.get(ADMIN_ROUTE)).status()).toBe(503);
});
