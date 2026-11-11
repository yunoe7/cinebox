/**
 * Persistent profile-PIN attempt guard.
 *
 * The PIN itself is never stored here: only a per-profile attempt counter and
 * an optional lockout expiry. This survives a page refresh without turning the
 * local PIN into a server-side authentication claim. As documented in the
 * profile UI, anyone with access to the browser storage can still reset it.
 */

import { PROFILE_PIN_ITERATIONS, verifyProfilePin } from "./profile-pin.mjs";

export const PROFILE_PIN_GUARD_KEY = "cinebox-profile-pin-guard";
export const MAX_PROFILE_PIN_ATTEMPTS = 5;
export const PROFILE_PIN_LOCKOUT_MS = 5 * 60 * 1000;

const GUARD_VERSION = 1;
const PIN_PATTERN = /^\d{4,8}$/;
const SALT_PATTERN = /^[a-f\d]{32}$/i;
const HASH_PATTERN = /^[a-f\d]{64}$/i;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function emptyGuard() {
  return { version: GUARD_VERSION, profiles: {} };
}

function normalizeEntry(value) {
  if (!isRecord(value)) return null;
  const attempts = Number.isInteger(value.attempts) && value.attempts > 0
    ? Math.min(value.attempts, MAX_PROFILE_PIN_ATTEMPTS)
    : 0;
  const lockedUntil = typeof value.lockedUntil === "number" && Number.isFinite(value.lockedUntil) && value.lockedUntil > 0
    ? value.lockedUntil
    : 0;
  return attempts || lockedUntil ? { attempts, lockedUntil } : null;
}

function readGuard(storage) {
  if (!storage || typeof storage.getItem !== "function") return emptyGuard();
  let raw;
  try {
    raw = storage.getItem(PROFILE_PIN_GUARD_KEY);
  } catch {
    return emptyGuard();
  }
  if (raw === null) return emptyGuard();
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== GUARD_VERSION || !isRecord(parsed.profiles)) return emptyGuard();
    const profiles = {};
    for (const [profileId, value] of Object.entries(parsed.profiles)) {
      const entry = normalizeEntry(value);
      if (entry) profiles[profileId] = entry;
    }
    return { version: GUARD_VERSION, profiles };
  } catch {
    return emptyGuard();
  }
}

function writeGuard(storage, guard) {
  if (!storage || typeof storage.setItem !== "function") return false;
  try {
    if (!Object.keys(guard.profiles).length && typeof storage.removeItem === "function") {
      storage.removeItem(PROFILE_PIN_GUARD_KEY);
      return true;
    }
    storage.setItem(PROFILE_PIN_GUARD_KEY, JSON.stringify(guard));
    return true;
  } catch {
    // A technical storage failure must never lock a profile permanently.
    return false;
  }
}

function validPinRecord(record) {
  return Boolean(record && typeof record === "object" &&
    typeof record.salt === "string" && SALT_PATTERN.test(record.salt) &&
    typeof record.hash === "string" && HASH_PATTERN.test(record.hash) &&
    record.iterations === PROFILE_PIN_ITERATIONS);
}

function summarize(entry, now) {
  const attempts = entry?.attempts ?? 0;
  const lockedUntil = entry?.lockedUntil ?? 0;
  const locked = lockedUntil > now;
  return {
    attempts,
    lockedUntil: locked ? lockedUntil : 0,
    locked,
    retryAfterMs: locked ? lockedUntil - now : 0,
    remainingAttempts: locked ? 0 : Math.max(0, MAX_PROFILE_PIN_ATTEMPTS - attempts),
  };
}

function resetExpiredEntry(storage, guard, profileId, entry, now) {
  if (!entry) return null;
  const expired = entry.lockedUntil > 0 && entry.lockedUntil <= now;
  if (!expired) return entry;
  delete guard.profiles[profileId];
  writeGuard(storage, guard);
  return null;
}

/** Read the current persistent attempt state for one profile. */
export function readProfilePinGuard(storage, profileId, now = Date.now()) {
  const guard = readGuard(storage);
  const entry = resetExpiredEntry(storage, guard, profileId, guard.profiles[profileId], now);
  return summarize(entry, now);
}

/** Record one failed PIN verification and lock the profile when the limit is reached. */
export function recordProfilePinFailure(storage, profileId, now = Date.now()) {
  const guard = readGuard(storage);
  const entry = resetExpiredEntry(storage, guard, profileId, guard.profiles[profileId], now);
  if (entry?.lockedUntil > now) return summarize(entry, now);
  const attempts = Math.min(MAX_PROFILE_PIN_ATTEMPTS, (entry?.attempts ?? 0) + 1);
  const next = {
    attempts,
    lockedUntil: attempts >= MAX_PROFILE_PIN_ATTEMPTS ? now + PROFILE_PIN_LOCKOUT_MS : 0,
  };
  guard.profiles[profileId] = next;
  writeGuard(storage, guard);
  return summarize(next, now);
}

/** Forget failures after a successful verification or a PIN change/removal. */
export function clearProfilePinFailures(storage, profileId) {
  const guard = readGuard(storage);
  delete guard.profiles[profileId];
  writeGuard(storage, guard);
}

/**
 * Verify a PIN while applying the persistent attempt policy.
 *
 * Malformed PINs, malformed PIN records and missing crypto support are treated
 * as technical/input errors: they never increment the counter, so a transient
 * error cannot lock a profile out.
 */
export async function verifyProfilePinGuarded(pin, record, options = {}) {
  const { storage = null, profileId, now = Date.now(), cryptoSource = globalThis.crypto } = options;
  const before = readProfilePinGuard(storage, profileId, now);
  if (before.locked) return { status: "locked", state: before };
  if (!PIN_PATTERN.test(String(pin ?? ""))) return { status: "invalid-format", state: before };
  if (!validPinRecord(record) || !cryptoSource?.subtle) {
    return { status: "unavailable", state: before };
  }
  let valid = false;
  try {
    valid = await verifyProfilePin(String(pin), record, cryptoSource);
  } catch {
    return { status: "unavailable", state: before };
  }
  if (valid) {
    clearProfilePinFailures(storage, profileId);
    return { status: "ok", state: readProfilePinGuard(storage, profileId, now) };
  }
  const state = recordProfilePinFailure(storage, profileId, now);
  return { status: state.locked ? "locked" : "incorrect", state };
}

/** Human-readable lockout duration, kept short enough for an inline alert. */
export function profilePinLockoutLabel(remainingMs) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (seconds <= 0) return "quelques instants";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest} s`;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
