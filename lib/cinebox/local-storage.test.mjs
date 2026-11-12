import test from "node:test";
import assert from "node:assert/strict";
import {
  initialValueFor,
  readLocalJson,
  writeLocalJson,
} from "./local-storage.mjs";

const isNumberArray = (value) => Array.isArray(value) && value.every(Number.isSafeInteger);
const isTitleArray = (value) => Array.isArray(value) && value.every((title) =>
  title !== null && typeof title === "object" && Number.isSafeInteger(title.id),
);

function memoryStorage(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    data,
  };
}

test("premier lancement: deux clés absentes donnent des tableaux vides", () => {
  const storage = memoryStorage();
  const titles = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
  const favorites = readLocalJson(() => storage, "cinebox-favorites", isNumberArray);

  assert.equal(titles.status, "missing");
  assert.equal(favorites.status, "missing");
  assert.deepEqual(initialValueFor(titles, []), []);
  assert.deepEqual(initialValueFor(favorites, []), []);
  assert.equal(storage.data.size, 0);
});

test("catalogue et favoris valides sont lus sans altération", () => {
  const storedTitles = [{ id: 12, name: "Film" }];
  const storedFavorites = [12];
  const storage = memoryStorage({
    "cinebox-titles": JSON.stringify(storedTitles),
    "cinebox-favorites": JSON.stringify(storedFavorites),
  });

  const titles = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
  const favorites = readLocalJson(() => storage, "cinebox-favorites", isNumberArray);
  assert.equal(titles.status, "valid");
  assert.equal(favorites.status, "valid");
  assert.deepEqual(titles.value, storedTitles);
  assert.deepEqual(favorites.value, storedFavorites);
});

test("JSON invalide est distingué d'une clé absente et reste intact", () => {
  const storage = memoryStorage({ "cinebox-titles": "{broken" });
  const result = readLocalJson(() => storage, "cinebox-titles", isTitleArray);

  assert.equal(result.status, "error");
  assert.equal(result.reason, "parse");
  assert.equal(storage.getItem("cinebox-titles"), "{broken");
});

test("localStorage inaccessible est signalé sans tentative de remplacement", () => {
  const result = readLocalJson(() => { throw new DOMException("denied", "SecurityError"); }, "cinebox-titles", isTitleArray);

  assert.equal(result.status, "error");
  assert.equal(result.reason, "access");
  const writeResult = writeLocalJson(() => { throw new DOMException("denied", "SecurityError"); }, "cinebox-titles", []);
  assert.equal(writeResult.ok, false);
  assert.equal(writeResult.reason, "access");
});

test("échec d'écriture par quota est retourné au lieu d'être masqué", () => {
  const storage = {
    getItem(key) { return key === "cinebox-recovery" ? null : "ancienne-valeur"; },
    setItem() { throw new DOMException("full", "QuotaExceededError"); },
  };
  const result = writeLocalJson(() => storage, "cinebox-titles", []);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "quota");
  assert.equal(storage.getItem("cinebox-titles"), "ancienne-valeur");
});

function snapshot(raw) {
  if (raw === null) return { kind: "absent" };
  if (raw === "") return { kind: "empty", raw };
  try { JSON.parse(raw); return { kind: "json", raw }; }
  catch { return { kind: "invalid-json", raw }; }
}

function installRecoveryJournal(storage, beforeTitles, beforeFavorites, afterTitles, afterFavorites) {
  storage.data.set("cinebox-recovery", JSON.stringify({
    version: 1,
    state: "pending",
    keys: { titles: "cinebox-titles", favorites: "cinebox-favorites" },
    before: { titles: snapshot(beforeTitles), favorites: snapshot(beforeFavorites) },
    after: { titles: snapshot(afterTitles), favorites: snapshot(afterFavorites) },
  }));
}

test("récupération au démarrage: les anciennes valeurs exactes résolvent le journal", () => {
  const beforeTitles = JSON.stringify([{ id: 31 }]);
  const beforeFavorites = "[31]";
  const storage = memoryStorage({ "cinebox-titles": beforeTitles, "cinebox-favorites": beforeFavorites });
  installRecoveryJournal(storage, beforeTitles, beforeFavorites, "[]", "[]");

  const result = readLocalJson(() => storage, "cinebox-titles", isTitleArray);

  assert.equal(result.status, "valid");
  assert.deepEqual(result.value, [{ id: 31 }]);
  assert.equal(storage.getItem("cinebox-titles"), beforeTitles);
  assert.equal(storage.getItem("cinebox-favorites"), beforeFavorites);
  assert.equal(storage.getItem("cinebox-recovery"), null);
});

test("récupération au démarrage: les nouvelles valeurs exactes confirment le commit", () => {
  const storage = memoryStorage({ "cinebox-titles": "[]", "cinebox-favorites": "[]" });
  installRecoveryJournal(storage, JSON.stringify([{ id: 32 }]), "[32]", "[]", "[]");

  const result = readLocalJson(() => storage, "cinebox-titles", isTitleArray);

  assert.equal(result.status, "valid");
  assert.deepEqual(result.value, []);
  assert.equal(storage.getItem("cinebox-titles"), "[]");
  assert.equal(storage.getItem("cinebox-favorites"), "[]");
  assert.equal(storage.getItem("cinebox-recovery"), null);
});

test("interruption de récupération: le journal reste et la lecture suivante reprend", () => {
  const beforeTitles = JSON.stringify([{ id: 33 }]);
  const beforeFavorites = "[33]";
  const storage = memoryStorage({ "cinebox-titles": "[]", "cinebox-favorites": beforeFavorites });
  installRecoveryJournal(storage, beforeTitles, beforeFavorites, "[]", "[]");
  const originalSetItem = storage.setItem;
  let interrupt = true;
  storage.setItem = (key, value) => {
    if (key === "cinebox-titles" && value === beforeTitles && interrupt) {
      interrupt = false;
      throw new DOMException("synthetic recovery interruption", "QuotaExceededError");
    }
    originalSetItem(key, value);
  };

  const interrupted = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
  assert.equal(interrupted.status, "error");
  assert.equal(interrupted.error.name, "LocalStorageRecoveryError");
  assert.notEqual(storage.getItem("cinebox-recovery"), null);
  assert.equal(storage.getItem("cinebox-titles"), "[]");

  const resumed = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
  assert.equal(resumed.status, "valid");
  assert.deepEqual(resumed.value, [{ id: 33 }]);
  assert.equal(storage.getItem("cinebox-titles"), beforeTitles);
  assert.equal(storage.getItem("cinebox-favorites"), beforeFavorites);
  assert.equal(storage.getItem("cinebox-recovery"), null);
});

test("journal invalide ou vide: les clés ne changent pas et aucune écriture ne remplace le journal", () => {
  for (const invalidJournal of ["", "{broken"]) {
    const beforeTitles = JSON.stringify([{ id: 34 }]);
    const storage = memoryStorage({ "cinebox-titles": beforeTitles, "cinebox-favorites": "[34]" });
    storage.data.set("cinebox-recovery", invalidJournal);

    const result = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
    const deletion = writeLocalJson(() => storage, "cinebox-favorites", []);

    assert.equal(result.status, "error");
    assert.equal(result.error.name, "LocalStorageRecoveryError");
    assert.equal(deletion.ok, false);
    assert.equal(deletion.reason, "access");
    assert.equal(storage.getItem("cinebox-recovery"), invalidJournal);
    assert.equal(storage.getItem("cinebox-titles"), beforeTitles);
    assert.equal(storage.getItem("cinebox-favorites"), "[34]");
  }

  const pending = memoryStorage({ "cinebox-titles": "[]", "cinebox-favorites": "[]" });
  installRecoveryJournal(pending, "[35]", "[35]", "[]", "[]");
  const pendingRaw = pending.getItem("cinebox-recovery");
  const blocked = writeLocalJson(() => pending, "cinebox-titles", [{ id: 36 }]);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "access");
  assert.equal(pending.getItem("cinebox-recovery"), pendingRaw);
  assert.equal(pending.getItem("cinebox-titles"), "[]");
  assert.equal(pending.getItem("cinebox-favorites"), "[]");
});

test("les instantanés distinguent clé absente, chaîne vide, JSON et JSON invalide", () => {
  const storage = memoryStorage({ "cinebox-titles": "[]", "cinebox-favorites": "[99]" });
  installRecoveryJournal(storage, null, "", "[]", "[]");

  const recoveredMissing = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
  assert.equal(recoveredMissing.status, "missing");
  assert.equal(storage.data.has("cinebox-titles"), false);
  assert.equal(storage.getItem("cinebox-favorites"), "");
  assert.equal(storage.getItem("cinebox-recovery"), null);

  storage.data.set("cinebox-titles", "[]");
  storage.data.set("cinebox-favorites", "[99]");
  installRecoveryJournal(storage, "{invalid-json", "[]", "[]", "[]");
  const recovered = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
  assert.equal(recovered.status, "error");
  assert.equal(recovered.reason, "parse");
  assert.equal(storage.getItem("cinebox-titles"), "{invalid-json");
  assert.equal(storage.getItem("cinebox-favorites"), "[]");
  assert.equal(storage.getItem("cinebox-recovery"), null);
});
