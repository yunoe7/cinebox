/**
 * Browser-side admin authentication client.
 *
 * The admin session lives in an HttpOnly cookie: JavaScript can never read it.
 * This module only talks to the auth endpoints and adds the CSRF header that
 * the server requires on every state-changing request.
 */

export const ADMIN_SESSION_ENDPOINT = "/api/account/session";
export const ADMIN_LOGOUT_ENDPOINT = "/api/account/logout";
export const ADMIN_CSRF_HEADER = "x-cinebox-request";
export const ADMIN_CSRF_VALUE = "1";

export class AdminAuthError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

export function isAdminAuthError(reason) {
  return reason instanceof AdminAuthError;
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

function errorMessage(payload, status) {
  return payload && typeof payload.error === "string" ? payload.error : `Erreur serveur (${status}).`;
}

/** The existing Discord account session is the only admin login mechanism. */
export async function getAdminSession() {
  try {
    const response = await fetch(ADMIN_SESSION_ENDPOINT, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
    if (!response.ok) return { authenticated: false, expiresAt: null };
    const payload = await readJson(response);
    return { authenticated: payload?.authenticated === true && payload?.user?.isAdmin === true, expiresAt: null };
  } catch {
    return { authenticated: false, expiresAt: null };
  }
}

/** Starts the Discord OAuth flow; no password is collected or stored. */
export async function loginAdmin() {
  window.location.assign("/api/auth/discord/start?mode=admin");
}

/** Ends the shared Discord account session. */
export async function logoutAdmin() {
  try {
    await fetch(ADMIN_LOGOUT_ENDPOINT, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { accept: "application/json", [ADMIN_CSRF_HEADER]: ADMIN_CSRF_VALUE },
    });
  } finally {
    window.location.assign("/connexion");
  }
}

/** Sends an authenticated request and surfaces 401 as an AdminAuthError. */
export async function adminFetch(path, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");
  headers.set(ADMIN_CSRF_HEADER, ADMIN_CSRF_VALUE);

  const response = await fetch(path, {
    ...init,
    headers,
    cache: init.cache ?? "no-store",
    credentials: "same-origin",
  });

  if (response.status === 401) {
    const payload = await readJson(response);
    throw new AdminAuthError(
      errorMessage(payload, response.status) || "Session administrateur expirée. Reconnecte-toi.",
      401,
    );
  }
  return response;
}

/** Like adminFetch, but parses JSON and throws on any non-2xx response. */
export async function adminJson(path, init = {}) {
  const response = await adminFetch(path, init);
  const payload = await readJson(response);
  if (!response.ok) throw new AdminAuthError(errorMessage(payload, response.status), response.status);
  return payload;
}
