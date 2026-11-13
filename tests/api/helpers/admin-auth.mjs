/**
 * Shared admin-auth fixtures for the Pages Functions API tests.
 *
 * Tests run over HTTPS URLs on purpose: the production cookie is the
 * `__Host-` prefixed one, and the routes must be exercised with that exact
 * name. The session secret and the password verifier are deterministic test
 * values, never real secrets.
 */
import {
  ADMIN_CSRF_HEADER,
  ADMIN_CSRF_VALUE,
  createAdminSession,
  hashAdminPassword,
  sessionCookieName,
} from "../../../lib/cinebox/admin-auth.mjs";

export const ADMIN_PASSWORD = "correct horse battery staple";
export const ADMIN_SESSION_SECRET = "unit-test-session-secret-that-is-long-enough-123";
export const ADMIN_PASSWORD_HASH = await hashAdminPassword(ADMIN_PASSWORD, {
  iterations: 100_000,
});

const DISCORD_TEST_TOKEN = "unit-test-discord-session-token";
const DISCORD_TEST_COOKIE = `__Host-cinebox_session=${DISCORD_TEST_TOKEN}`;

export const ADMIN_ENV = Object.freeze({
  CINEBOX_ADMIN_PASSWORD_HASH: ADMIN_PASSWORD_HASH,
  CINEBOX_SESSION_SECRET: ADMIN_SESSION_SECRET,
});

/** Builds the `Cookie` header value the browser would send on HTTPS. */
export function adminCookieHeader(token) {
  return `${sessionCookieName({ secure: true })}=${token}`;
}

/** Creates a fresh, valid signed session cookie. */
export async function createAdminCookie({ now = Date.now(), ttlSeconds } = {}) {
  const session = await createAdminSession({
    secret: ADMIN_SESSION_SECRET,
    now,
    ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
  });
  return adminCookieHeader(session.token);
}

/**
 * Headers for a same-origin admin request.
 * `authenticated: false` omits the cookie but keeps Origin/CSRF valid, so the
 * route answers 401 (authentication) rather than 403 (CSRF).
 */
export function adminHeaders({
  authenticated = true,
  cookie = VALID_ADMIN_COOKIE,
  origin = "https://cinebox.test",
  csrf = true,
  extra = {},
} = {}) {
  const headers = {
    origin,
    "sec-fetch-site": "same-origin",
    ...extra,
  };
  if (csrf) headers[ADMIN_CSRF_HEADER] = ADMIN_CSRF_VALUE;
  if (authenticated) headers.cookie = cookie;
  return headers;
}


/** Test-only D1 adapter: supplies a Discord admin account while preserving catalogue queries. */
export function withDiscordAdminDb(db) {
  return {
    prepare(sql) {
      if (/SELECT u\\.id,u\\.display_name,u\\.role,u\\.email,s\\.expires_at FROM account_sessions/.test(sql)) {
        return { bind() { return this; }, first: async () => ({
          id: "test-admin-user", display_name: "Test Admin", role: "user", email: null,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }) };
      }
      if (/SELECT 1 AS allowed FROM users u LEFT JOIN auth_identities/.test(sql)) {
        return { bind() { return this; }, first: async () => ({ allowed: 1 }) };
      }
      return db.prepare(sql);
    },
    batch: (...args) => db.batch(...args),
  };
}

export function discordAdminHeaders({ authenticated = true, origin = "https://cinebox.test", csrf = true, extra = {} } = {}) {
  const headers = { origin, "sec-fetch-site": "same-origin", ...extra };
  if (csrf) headers[ADMIN_CSRF_HEADER] = ADMIN_CSRF_VALUE;
  if (authenticated) headers.cookie = DISCORD_TEST_COOKIE;
  return headers;
}

/** Cookie for tests that do not need to await a helper at call time. */
export const VALID_ADMIN_COOKIE = await createAdminCookie();
