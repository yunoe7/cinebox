import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { hashProfilePin } from "./profile-pin.mjs";
import {
  MAX_PROFILE_PIN_ATTEMPTS,
  PROFILE_PIN_GUARD_KEY,
  PROFILE_PIN_LOCKOUT_MS,
  clearProfilePinFailures,
  profilePinLockoutLabel,
  readProfilePinGuard,
  recordProfilePinFailure,
  verifyProfilePinGuarded,
} from "./profile-pin-guard.mjs";

function memoryStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
    entries,
  };
}

const PROFILE_ID = "profile-locked";

async function pinRecord(pin = "1234") {
  return hashProfilePin(pin, webcrypto);
}

function guarded(pin, record, storage, now) {
  return verifyProfilePinGuarded(pin, record, { storage, profileId: PROFILE_ID, now, cryptoSource: webcrypto });
}

test("un PIN correct ouvre le profil et ne laisse aucune trace d’échec", async () => {
  const storage = memoryStorage();
  const record = await pinRecord("1234");
  const result = await guarded("1234", record, storage, 1_000);
  assert.equal(result.status, "ok");
  assert.equal(result.state.attempts, 0);
  assert.equal(result.state.locked, false);
  assert.equal(storage.getItem(PROFILE_PIN_GUARD_KEY), null);
});

test("un PIN incorrect incrémente les tentatives et les conserve après rechargement", async () => {
  const storage = memoryStorage();
  const record = await pinRecord("1234");
  const first = await guarded("0000", record, storage, 1_000);
  assert.equal(first.status, "incorrect");
  assert.equal(first.state.attempts, 1);
  assert.equal(first.state.remainingAttempts, MAX_PROFILE_PIN_ATTEMPTS - 1);

  // A new page load reuses the same localStorage; the counter must survive.
  const reloaded = readProfilePinGuard(storage, PROFILE_ID, 2_000);
  assert.equal(reloaded.attempts, 1);
  assert.equal(reloaded.locked, false);

  const second = await guarded("1111", record, storage, 2_500);
  assert.equal(second.state.attempts, 2);
});

test("la cinquième erreur verrouille le profil pendant la durée prévue", async () => {
  const storage = memoryStorage();
  const record = await pinRecord("1234");
  let state;
  for (let attempt = 1; attempt <= MAX_PROFILE_PIN_ATTEMPTS; attempt++) {
    const result = await guarded("0000", record, storage, attempt * 1_000);
    state = result.state;
    if (attempt < MAX_PROFILE_PIN_ATTEMPTS) {
      assert.equal(result.status, "incorrect");
      assert.equal(state.locked, false);
    } else {
      assert.equal(result.status, "locked");
      assert.equal(state.locked, true);
      assert.equal(state.lockedUntil, attempt * 1_000 + PROFILE_PIN_LOCKOUT_MS);
    }
  }
  assert.equal(state.remainingAttempts, 0);

  // Even the correct PIN is refused while the lockout is active.
  const blocked = await guarded("1234", record, storage, MAX_PROFILE_PIN_ATTEMPTS * 1_000 + 1);
  assert.equal(blocked.status, "locked");
  assert.equal(blocked.state.locked, true);
});

test("le verrouillage expire et redonne une chance sans redémarrer le compteur", async () => {
  const storage = memoryStorage();
  const record = await pinRecord("1234");
  for (let attempt = 1; attempt <= MAX_PROFILE_PIN_ATTEMPTS; attempt++) {
    await guarded("0000", record, storage, attempt * 1_000);
  }
  const lockedUntil = MAX_PROFILE_PIN_ATTEMPTS * 1_000 + PROFILE_PIN_LOCKOUT_MS;
  const expired = readProfilePinGuard(storage, PROFILE_ID, lockedUntil + 1);
  assert.equal(expired.locked, false);
  assert.equal(expired.attempts, 0);
  assert.equal(storage.getItem(PROFILE_PIN_GUARD_KEY), null);

  const retry = await guarded("1234", record, storage, lockedUntil + 2);
  assert.equal(retry.status, "ok");
});

test("un format invalide n’ajoute pas de tentative", async () => {
  const storage = memoryStorage();
  const record = await pinRecord("1234");
  for (const bad of ["", "12", "abcd", "123456789"]) {
    const result = await guarded(bad, record, storage, 1_000);
    assert.equal(result.status, "invalid-format");
    assert.equal(result.state.attempts, 0);
  }
  assert.equal(storage.getItem(PROFILE_PIN_GUARD_KEY), null);
});

test("une erreur technique ne verrouille jamais le profil", async () => {
  const storage = memoryStorage();
  const record = await pinRecord("1234");

  const noCrypto = await verifyProfilePinGuarded("1234", record, {
    storage, profileId: PROFILE_ID, now: 1_000, cryptoSource: null,
  });
  assert.equal(noCrypto.status, "unavailable");
  assert.equal(noCrypto.state.attempts, 0);

  const malformed = await guarded("1234", { salt: "zz", hash: "zz", iterations: 180000 }, storage, 2_000);
  assert.equal(malformed.status, "unavailable");
  assert.equal(malformed.state.attempts, 0);

  const corrupt = memoryStorage({ [PROFILE_PIN_GUARD_KEY]: "{not json" });
  const recovered = await guarded("1234", record, corrupt, 3_000);
  assert.equal(recovered.status, "ok");
  assert.equal(corrupt.getItem(PROFILE_PIN_GUARD_KEY), null);
});

test("le stockage ne contient que le compteur et l’expiration, jamais le PIN", async () => {
  const storage = memoryStorage();
  const record = await pinRecord("1234");
  await guarded("0000", record, storage, 1_000);
  const raw = storage.getItem(PROFILE_PIN_GUARD_KEY);
  assert.ok(raw);
  assert.doesNotMatch(raw, /0000/);
  assert.doesNotMatch(raw, /1234/);
  const parsed = JSON.parse(raw);
  assert.deepEqual(Object.keys(parsed.profiles[PROFILE_ID]).sort(), ["attempts", "lockedUntil"]);
});

test("un succès ou un changement de PIN efface les échecs enregistrés", async () => {
  const storage = memoryStorage();
  const record = await pinRecord("1234");
  await guarded("0000", record, storage, 1_000);
  await guarded("0001", record, storage, 2_000);
  assert.equal(readProfilePinGuard(storage, PROFILE_ID, 2_500).attempts, 2);

  clearProfilePinFailures(storage, PROFILE_ID);
  assert.equal(readProfilePinGuard(storage, PROFILE_ID, 2_500).attempts, 0);

  await guarded("0000", record, storage, 3_000);
  await guarded("1234", record, storage, 3_500);
  assert.equal(readProfilePinGuard(storage, PROFILE_ID, 3_600).attempts, 0);
});

test("recordProfilePinFailure ne dépasse pas la limite et reste stable une fois verrouillé", async () => {
  const storage = memoryStorage();
  let state;
  for (let attempt = 1; attempt <= MAX_PROFILE_PIN_ATTEMPTS + 3; attempt++) {
    state = recordProfilePinFailure(storage, PROFILE_ID, attempt * 1_000);
  }
  assert.equal(state.attempts, MAX_PROFILE_PIN_ATTEMPTS);
  assert.equal(state.locked, true);
  assert.equal(state.lockedUntil, MAX_PROFILE_PIN_ATTEMPTS * 1_000 + PROFILE_PIN_LOCKOUT_MS);
});

test("le libellé de verrouillage reste lisible", () => {
  assert.equal(profilePinLockoutLabel(0), "quelques instants");
  assert.equal(profilePinLockoutLabel(30_000), "30 s");
  assert.equal(profilePinLockoutLabel(60_000), "1 min");
  assert.equal(profilePinLockoutLabel(125_000), "2 min 5 s");
});
