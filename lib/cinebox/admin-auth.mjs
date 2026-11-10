/**
 * Server-only admin authentication primitives.
 *
 * This module is imported by Cloudflare Pages Functions and by tests. It must
 * never be imported from a client component: it owns the session secret and
 * the password verifier, and nothing here is meant to run in a browser.
 *
 * Session format: base64url(payload) + "." + base64url(HMAC-SHA256(payload)).
 * The payload is stateless; logout works by clearing the HttpOnly cookie.
 */

export const ADMIN_SESSION_COOKIE = "__Host-cinebox_admin";
export const ADMIN_SESSION_COOKIE_DEV = "cinebox_admin";
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const ADMIN_SESSION_SECRET_MIN_LENGTH = 32;
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
export const ADMIN_PASSWORD_ITERATIONS_DEFAULT = 210_000;
export const ADMIN_PASSWORD_ITERATIONS_MIN = 100_000;
export const ADMIN_PASSWORD_ITERATIONS_MAX = 1_000_000;
export const ADMIN_CSRF_HEADER = "x-cinebox-request";
export const ADMIN_CSRF_VALUE = "1";

const encoder = new TextEncoder();
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function assertSessionSecret(secret) {
  if (typeof secret !== "string" || secret.length < ADMIN_SESSION_SECRET_MIN_LENGTH) {
    throw new Error(`Le secret de session doit contenir au moins ${ADMIN_SESSION_SECRET_MIN_LENGTH} caractères.`);
  }
}

async function hmacSha256(secret, value) {
  assertSessionSecret(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return new Uint8Array(signature);
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Parses `pbkdf2-sha256$<iterations>$<salt>$<hash>`.
 * Returns null for anything malformed or outside the accepted cost range.
 */
export function parsePasswordHash(encoded) {
  if (typeof encoded !== "string") return null;
  const parts = encoded.trim().split("$");
  if (parts.length !== 4 || parts[0] !== ADMIN_PASSWORD_HASH_ALGORITHM) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) ||
      iterations < ADMIN_PASSWORD_ITERATIONS_MIN ||
      iterations > ADMIN_PASSWORD_ITERATIONS_MAX) return null;
  try {
    const salt = fromBase64Url(parts[2]);
    const hash = fromBase64Url(parts[3]);
    if (salt.length < 16 || hash.length !== 32) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

/** Derives a PBKDF2-SHA256 verifier and returns its portable encoded form. */
export async function hashAdminPassword(password, {
  iterations = ADMIN_PASSWORD_ITERATIONS_DEFAULT,
  salt,
} = {}) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("Le mot de passe administrateur est requis.");
  }
  if (!Number.isInteger(iterations) ||
      iterations < ADMIN_PASSWORD_ITERATIONS_MIN ||
      iterations > ADMIN_PASSWORD_ITERATIONS_MAX) {
    throw new RangeError("Nombre d'itérations PBKDF2 invalide.");
  }
  const actualSalt = salt instanceof Uint8Array ? salt : randomBytes(16);
  if (actualSalt.length < 16) throw new RangeError("Le sel PBKDF2 doit contenir au moins 16 octets.");
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: actualSalt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return `${ADMIN_PASSWORD_HASH_ALGORITHM}$${iterations}$${toBase64Url(actualSalt)}$${toBase64Url(new Uint8Array(derived))}`;
}

/** Verifies a password against an encoded PBKDF2 verifier in constant time. */
export async function verifyAdminPassword(password, encoded) {
  if (typeof password !== "string" || password.length === 0) return false;
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: parsed.salt, iterations: parsed.iterations, hash: "SHA-256" },
      key,
      256,
    ));
    return constantTimeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/** Creates a signed, stateless admin session. TTL can never exceed 12 hours. */
export async function createAdminSession({
  secret,
  now = Date.now(),
  ttlSeconds = ADMIN_SESSION_TTL_SECONDS,
} = {}) {
  assertSessionSecret(secret);
  const ttl = Math.floor(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > ADMIN_SESSION_TTL_SECONDS) {
    throw new RangeError(`La durée de session doit être comprise entre 1 et ${ADMIN_SESSION_TTL_SECONDS} secondes.`);
  }
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    v: 1,
    sub: "admin",
    iat: issuedAt,
    exp: issuedAt + ttl,
    jti: toBase64Url(randomBytes(16)),
  };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = toBase64Url(await hmacSha256(secret, encoded));
  return {
    token: `${encoded}.${signature}`,
    issuedAt: payload.iat * 1000,
    expiresAt: payload.exp * 1000,
  };
}

/** Verifies signature, shape and lifetime of an admin session. */
export async function verifyAdminSession(token, { secret, now = Date.now() } = {}) {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    return { valid: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: "malformed" };

  let suppliedSignature;
  let expectedSignature;
  try {
    suppliedSignature = fromBase64Url(parts[1]);
    expectedSignature = await hmacSha256(secret, parts[0]);
  } catch {
    return { valid: false, reason: "signature" };
  }
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return { valid: false, reason: "signature" };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
  } catch {
    return { valid: false, reason: "payload" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { valid: false, reason: "payload" };
  if (payload.v !== 1 || payload.sub !== "admin") return { valid: false, reason: "payload" };
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return { valid: false, reason: "payload" };
  if (payload.exp <= payload.iat || payload.exp - payload.iat > ADMIN_SESSION_TTL_SECONDS) {
    return { valid: false, reason: "payload" };
  }

  const nowSeconds = Math.floor(now / 1000);
  if (payload.iat > nowSeconds + 60) return { valid: false, reason: "not-yet-valid" };
  if (payload.exp <= nowSeconds) return { valid: false, reason: "expired" };

  return {
    valid: true,
    issuedAt: payload.iat * 1000,
    expiresAt: payload.exp * 1000,
  };
}

/** `__Host-` requires Secure, Path=/ and no Domain; HTTP dev falls back to a plain name. */
export function sessionCookieName({ secure } = {}) {
  return secure ? ADMIN_SESSION_COOKIE : ADMIN_SESSION_COOKIE_DEV;
}

export function buildSessionCookie(token, { secure = true, maxAge = ADMIN_SESSION_TTL_SECONDS } = {}) {
  if (typeof token !== "string" || token.length === 0) throw new TypeError("Jeton de session requis.");
  const attributes = [
    `${sessionCookieName({ secure })}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(maxAge)}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function buildClearSessionCookie({ secure = true } = {}) {
  const attributes = [
    `${sessionCookieName({ secure })}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function readCookie(cookieHeader, name) {
  if (typeof cookieHeader !== "string" || !cookieHeader || typeof name !== "string" || !name) return "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return "";
}

export function requiresCsrf(method) {
  return unsafeMethods.has(String(method || "GET").toUpperCase());
}

/**
 * CSRF protection for state-changing requests:
 * - SameSite=Strict cookie (set by the login route);
 * - exact Origin match;
 * - same-origin Sec-Fetch-Site when the browser sends it;
 * - mandatory custom header, which cross-site HTML forms cannot set.
 */
export function verifyRequestOrigin(request) {
  if (!requiresCsrf(request.method)) return { ok: true };
  let expectedOrigin;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { ok: false, reason: "url" };
  }
  const origin = request.headers.get("origin");
  if (origin !== expectedOrigin) return { ok: false, reason: "origin" };
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return { ok: false, reason: "site" };
  if (request.headers.get(ADMIN_CSRF_HEADER) !== ADMIN_CSRF_VALUE) return { ok: false, reason: "csrf" };
  return { ok: true };
}
