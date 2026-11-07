function errorReason(error, fallback = "access") {
  const name = error && typeof error === "object" ? error.name : "";
  if (name === "QuotaExceededError") return "quota";
  if (name === "SecurityError" || name === "NotAllowedError") return "access";
  return fallback;
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

const TITLES_KEY = "cinebox-titles";
const FAVORITES_KEY = "cinebox-favorites";
const RECOVERY_KEY = "cinebox-recovery";

function recoveryError(message) {
  const error = new Error(message);
  error.name = "LocalStorageRecoveryError";
  return error;
}

function inspectRawValue(raw) {
  if (raw === null) return { kind: "absent" };
  if (raw === "") return { kind: "empty", raw };
  try {
    JSON.parse(raw);
    return { kind: "json", raw };
  } catch {
    return { kind: "invalid-json", raw };
  }
}

function isRawSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.kind === "absent") return !Object.hasOwn(value, "raw");
  if (!(["empty", "json", "invalid-json"].includes(value.kind)) || typeof value.raw !== "string") return false;
  return inspectRawValue(value.raw).kind === value.kind;
}

function isRecoveryJournal(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    value.version === 1 && value.state === "pending" &&
    value.keys && value.keys.titles === TITLES_KEY && value.keys.favorites === FAVORITES_KEY &&
    value.before && isRawSnapshot(value.before.titles) && isRawSnapshot(value.before.favorites) &&
    value.after && isRawSnapshot(value.after.titles) && isRawSnapshot(value.after.favorites));
}

function readRecoveryJournal(storage) {
  const raw = storage.getItem(RECOVERY_KEY);
  if (raw === null) return { status: "missing" };
  if (raw === "") return { status: "invalid", error: recoveryError("Le journal de récupération est vide.") };
  try {
    const value = JSON.parse(raw);
    return isRecoveryJournal(value)
      ? { status: "valid", value, raw }
      : { status: "invalid", error: recoveryError("Le journal de récupération est invalide.") };
  } catch {
    return { status: "invalid", error: recoveryError("Le journal de récupération est invalide.") };
  }
}

function rawMatchesSnapshot(raw, snapshot) {
  return inspectRawValue(raw).kind === snapshot.kind &&
    (snapshot.kind === "absent" || raw === snapshot.raw);
}

function snapshotsEqual(storage, snapshots) {
  return rawMatchesSnapshot(storage.getItem(TITLES_KEY), snapshots.titles) &&
    rawMatchesSnapshot(storage.getItem(FAVORITES_KEY), snapshots.favorites);
}

function writeSnapshot(storage, key, snapshot) {
  if (snapshot.kind === "absent") storage.removeItem(key);
  else storage.setItem(key, snapshot.raw);
}

function removeVerifiedJournal(storage, snapshots) {
  if (!snapshotsEqual(storage, snapshots)) {
    throw recoveryError("Les valeurs du catalogue et des favoris ne correspondent pas à l’instantané vérifié.");
  }
  try {
    storage.removeItem(RECOVERY_KEY);
  } catch (error) {
    if (storage.getItem(RECOVERY_KEY) !== null) throw error;
  }
  if (storage.getItem(RECOVERY_KEY) !== null) {
    throw recoveryError("Le journal de récupération n’a pas pu être résolu.");
  }
}

function recoverPendingJournal(storage) {
  const journal = readRecoveryJournal(storage);
  if (journal.status === "missing") return;
  if (journal.status === "invalid") throw journal.error;

  const { before, after } = journal.value;
  if (snapshotsEqual(storage, before)) {
    removeVerifiedJournal(storage, before);
    return;
  }
  if (snapshotsEqual(storage, after)) {
    removeVerifiedJournal(storage, after);
    return;
  }

  try {
    if (!rawMatchesSnapshot(storage.getItem(TITLES_KEY), before.titles)) writeSnapshot(storage, TITLES_KEY, before.titles);
    if (!rawMatchesSnapshot(storage.getItem(FAVORITES_KEY), before.favorites)) writeSnapshot(storage, FAVORITES_KEY, before.favorites);
  } catch (error) {
    throw recoveryError(`La récupération reste en attente : ${asError(error).message}`);
  }
  if (!snapshotsEqual(storage, before)) {
    throw recoveryError("La restauration des anciennes valeurs n’a pas pu être vérifiée.");
  }
  removeVerifiedJournal(storage, before);
}

function restorePair(storage, before) {
  try {
    if (!rawMatchesSnapshot(storage.getItem(TITLES_KEY), before.titles)) writeSnapshot(storage, TITLES_KEY, before.titles);
  } catch { /* Exact verification below decides whether recovery is complete. */ }
  try {
    if (!rawMatchesSnapshot(storage.getItem(FAVORITES_KEY), before.favorites)) writeSnapshot(storage, FAVORITES_KEY, before.favorites);
  } catch { /* Exact verification below decides whether recovery is complete. */ }
  try {
    return snapshotsEqual(storage, before);
  } catch {
    return false;
  }
}

/**
 * @template T
 * @param {() => Pick<Storage, "getItem">} getStorage
 * @param {string} key
 * @param {(value: unknown) => value is T} validate
 * @returns {{ status: "missing" } | { status: "valid", value: T, raw: string } | { status: "error", reason: "access" | "parse" | "invalid", error: Error }}
 */
export function readLocalJson(getStorage, key, validate) {
  let raw;
  try {
    const storage = getStorage();
    if (key === TITLES_KEY) recoverPendingJournal(storage);
    raw = storage.getItem(key);
  } catch (error) {
    if (error?.name === "LocalStorageRecoveryError") {
      return { status: "error", reason: "invalid", error: asError(error) };
    }
    return { status: "error", reason: errorReason(error), error: asError(error) };
  }

  if (raw === null) return { status: "missing" };

  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { status: "error", reason: "parse", error: asError(error) };
  }

  if (!validate(value)) {
    return { status: "error", reason: "invalid", error: new Error(`Donnée invalide dans ${key}.`) };
  }
  return { status: "valid", value, raw };
}

/** @template T @param {{ status: string, value?: T }} result @param {T} fallback @returns {T} */
export function initialValueFor(result, fallback) {
  return result.status === "valid" ? result.value : fallback;
}

/**
 * Reconcile only when both entries were read and validated. A missing or
 * unreadable catalogue must never cause an existing favorites list to reset.
 * @param {{ status: string, value?: Array<{id: number}> }} titles
 * @param {{ status: string, value?: number[] }} favorites
 * @returns {{ value: number[], changed: boolean }}
 */
export function reconcileFavorites(titles, favorites) {
  if (favorites.status !== "valid") {
    return { value: favorites.status === "missing" ? [] : [], changed: false };
  }
  if (titles.status !== "valid") return { value: favorites.value, changed: false };

  const titleIds = new Set(titles.value.map((title) => title.id));
  const value = favorites.value.filter((id) => titleIds.has(id));
  return { value, changed: value.length !== favorites.value.length };
}

/**
 * @template T
 * @param {() => Pick<Storage, "setItem">} getStorage
 * @param {string} key
 * @param {T} value
 * @returns {{ ok: true } | { ok: false, reason: "quota" | "access" | "serialize", error: Error }}
 */
export function writeLocalJson(getStorage, key, value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    return { ok: false, reason: "serialize", error: asError(error) };
  }

  try {
    const storage = getStorage();
    if (key === TITLES_KEY || key === FAVORITES_KEY) {
      const journal = readRecoveryJournal(storage);
      if (journal.status !== "missing") {
        return { ok: false, reason: "access", error: journal.status === "invalid" ? journal.error : recoveryError("Une récupération est en attente.") };
      }
    }
    storage.setItem(key, serialized);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorReason(error), error: asError(error) };
  }
}

/**
 * Write two existing keys as one logical operation. If the second write fails,
 * restore both exact previous values and report whether rollback was verified.
 */
export function writeLocalJsonPair(getStorage, firstKey, firstValue, secondKey, secondValue) {
  let firstSerialized;
  let secondSerialized;
  try {
    firstSerialized = JSON.stringify(firstValue);
    secondSerialized = JSON.stringify(secondValue);
  } catch (error) {
    return { ok: false, reason: "serialize", rollbackFailed: false, error: asError(error) };
  }

  let storage;
  let before;
  let after;
  try {
    storage = getStorage();
    const existingJournal = readRecoveryJournal(storage);
    if (existingJournal.status !== "missing") {
      return {
        ok: false,
        reason: "access",
        rollbackFailed: true,
        error: existingJournal.status === "invalid" ? existingJournal.error : recoveryError("Une récupération est déjà en attente."),
      };
    }
    before = {
      titles: inspectRawValue(storage.getItem(firstKey)),
      favorites: inspectRawValue(storage.getItem(secondKey)),
    };
    after = {
      titles: inspectRawValue(firstSerialized),
      favorites: inspectRawValue(secondSerialized),
    };
  } catch (error) {
    return { ok: false, reason: errorReason(error), rollbackFailed: false, error: asError(error) };
  }

  const journal = {
    version: 1,
    state: "pending",
    keys: { titles: firstKey, favorites: secondKey },
    before,
    after,
  };
  let journalSerialized;
  try {
    journalSerialized = JSON.stringify(journal);
    storage.setItem(RECOVERY_KEY, journalSerialized);
  } catch (error) {
    return { ok: false, reason: errorReason(error), rollbackFailed: false, error: asError(error) };
  }
  try {
    if (storage.getItem(RECOVERY_KEY) !== journalSerialized) {
      return { ok: false, reason: "access", rollbackFailed: true, error: recoveryError("Le journal n’a pas pu être vérifié.") };
    }
  } catch (error) {
    return { ok: false, reason: errorReason(error), rollbackFailed: true, error: asError(error) };
  }

  let failure;
  try {
    storage.setItem(firstKey, firstSerialized);
    storage.setItem(secondKey, secondSerialized);
  } catch (error) {
    failure = error;
  }

  if (failure) {
    if (!restorePair(storage, before)) {
      return { ok: false, reason: errorReason(failure), rollbackFailed: true, error: asError(failure) };
    }
    try {
      removeVerifiedJournal(storage, before);
      return { ok: false, reason: errorReason(failure), rollbackFailed: false, error: asError(failure) };
    } catch (error) {
      return { ok: false, reason: errorReason(failure), rollbackFailed: true, error: asError(error) };
    }
  }

  try {
    removeVerifiedJournal(storage, after);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorReason(error), rollbackFailed: true, error: asError(error) };
  }
}
