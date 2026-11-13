import { expect, test } from "@playwright/test";
import { TEST_ORIGIN } from "./test-config.mjs";

const LEGACY_LOGIN = "/api/auth/login";
const LEGACY_LOGOUT = "/api/auth/logout";
const LEGACY_SESSION = "/api/auth/session";
const ACCOUNT_SESSION = "/api/account/session";
const ACCOUNT_LOGOUT = "/api/account/logout";
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
  return response.headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);
}

test("l'API réelle refuse les anciens cookies et jetons admin sans session Discord", async ({ request }) => {
  const legacySession = await request.get(LEGACY_SESSION);
  expect(legacySession.status()).toBe(200);
  expect(await legacySession.json()).toEqual({ authenticated: false, configured: false });

  // Une requête anonyme sans cookie est une réponse normale, pas une erreur serveur.
  const accountSession = await request.get(ACCOUNT_SESSION);
  expect(accountSession.status()).toBe(200);
  expect(await accountSession.json()).toEqual({ authenticated: false, user: null });

  // Sans D1, la route admin doit échouer de façon fermée, même avec un ancien Bearer.
  const denied = await request.get(ADMIN_ROUTE);
  expect(denied.status()).toBe(503);
  expect(await denied.json()).toEqual({ error: "Base de données indisponible." });

  const legacyBearer = await request.get(ADMIN_ROUTE, {
    headers: { authorization: "Bearer legacy-admin-token-that-is-long-enough" },
  });
  expect(legacyBearer.status()).toBe(503);
  expect(await legacyBearer.json()).toEqual({ error: "Base de données indisponible." });
});

test("l'ancienne connexion par mot de passe est désactivée sans émettre de cookie", async ({ request }) => {
  for (const options of [
    { headers: mutationHeaders(), data: { password: "legacy-password" } },
    { headers: { origin: TEST_ORIGIN }, data: { password: "legacy-password" } },
    { headers: mutationHeaders({ origin: "https://evil.test" }), data: { password: "legacy-password" } },
    { headers: mutationHeaders(), data: {} },
  ]) {
    const response = await request.post(LEGACY_LOGIN, options);
    expect(response.status()).toBe(410);
    expect(await response.json()).toEqual({
      error: "La connexion par mot de passe est désactivée. Utilise Discord OAuth.",
    });
    expect(setCookieHeaders(response)).toEqual([]);
  }
});

test("la déconnexion du compte Discord exige une origine et un en-tête CSRF valides", async ({ request }) => {
  const withoutCsrf = await request.post(ACCOUNT_LOGOUT, {
    headers: { origin: TEST_ORIGIN, "sec-fetch-site": "same-origin" },
  });
  expect(withoutCsrf.status()).toBe(403);
  expect(await withoutCsrf.json()).toEqual({ error: "Requête refusée." });
  expect(setCookieHeaders(withoutCsrf)).toEqual([]);

  const foreignOrigin = await request.post(ACCOUNT_LOGOUT, {
    headers: mutationHeaders({ origin: "https://evil.test" }),
  });
  expect(foreignOrigin.status()).toBe(403);
  expect(await foreignOrigin.json()).toEqual({ error: "Requête refusée." });
  expect(setCookieHeaders(foreignOrigin)).toEqual([]);
});

test("l'ancienne déconnexion admin est un no-op et ne touche pas au cookie Discord", async ({ request }) => {
  const response = await request.post(LEGACY_LOGOUT, {
    headers: mutationHeaders(),
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ authenticated: false });
  expect(setCookieHeaders(response)).toEqual([]);
});
