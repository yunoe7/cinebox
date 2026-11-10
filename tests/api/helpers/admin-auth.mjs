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

/** Cookie for tests that do not need to await a helper at call time. */
export const VALID_ADMIN_COOKIE = await createAdminCookie();
