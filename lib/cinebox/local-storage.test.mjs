import test from "node:test";
import assert from "node:assert/strict";
import {
  initialValueFor,
  readLocalJson,
  reconcileFavorites,
  writeLocalJson,
  writeLocalJsonPair,
} from "./local-storage.mjs";
import { commitMetadataThenCleanup } from "./media-lifecycle.mjs";

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

test("catalogue illisible: les favoris valides sont conservés sans réconciliation", () => {
  const invalidTitles = { status: "error", reason: "parse", error: new Error("bad JSON") };
  const validFavorites = { status: "valid", value: [2, 5], raw: "[2,5]" };
  const result = reconcileFavorites(invalidTitles, validFavorites);

  assert.deepEqual(result, { value: [2, 5], changed: false });
});

test("seuls les favoris sans titre correspondant sont retirés d'un catalogue valide", () => {
  const titles = { status: "valid", value: [{ id: 2 }], raw: "[{\"id\":2}]" };
  const favorites = { status: "valid", value: [2, 5], raw: "[2,5]" };

  assert.deepEqual(reconcileFavorites(titles, favorites), { value: [2], changed: true });
});

test("transaction suppression: rollback du catalogue si l'écriture des favoris échoue", () => {
  const beforeTitles = [{ id: 21, posterAssetKey: "21:poster:v:old" }];
  const beforeFavorites = [21];
  const storage = memoryStorage({ "cinebox-titles": JSON.stringify(beforeTitles), "cinebox-favorites": JSON.stringify(beforeFavorites) });
  const originalSetItem = storage.setItem;
  let failed = false;
  storage.setItem = (key, value) => {
    if (key === "cinebox-favorites" && !failed) { failed = true; throw new DOMException("quota", "QuotaExceededError"); }
    originalSetItem(key, value);
  };

  const result = writeLocalJsonPair(() => storage, "cinebox-titles", [], "cinebox-favorites", []);
  assert.equal(result.ok, false);
  assert.equal(result.rollbackFailed, false);
  assert.deepEqual(JSON.parse(storage.getItem("cinebox-titles")), beforeTitles);
  assert.deepEqual(JSON.parse(storage.getItem("cinebox-favorites")), beforeFavorites);
  assert.equal(storage.getItem("cinebox-recovery"), null);
});

test("transaction suppression: un échec de rollback conserve les deux instantanés et l'actif référencé", () => {
  const beforeTitles = [{ id: 22, videoAssetKey: "22:video:v:old" }];
  const beforeFavorites = [22];
  const storage = memoryStorage({ "cinebox-titles": JSON.stringify(beforeTitles), "cinebox-favorites": JSON.stringify(beforeFavorites) });
  const originalSetItem = storage.setItem;
  let favoriteWriteFailed = false;
  storage.setItem = (key, value) => {
    if (key === "cinebox-favorites" && !favoriteWriteFailed) {
      favoriteWriteFailed = true;
      throw new DOMException("quota synthétique", "QuotaExceededError");
    }
    if (key === "cinebox-titles" && value === JSON.stringify(beforeTitles)) {
      throw new DOMException("rollback synthétique impossible", "SecurityError");
    }
    originalSetItem(key, value);
  };

  const result = writeLocalJsonPair(() => storage, "cinebox-titles", [], "cinebox-favorites", []);

  assert.equal(result.ok, false);
  assert.equal(result.rollbackFailed, true);
  assert.equal(storage.getItem("cinebox-titles"), "[]");
  assert.equal(storage.getItem("cinebox-favorites"), JSON.stringify(beforeFavorites));
  assert.notEqual(storage.getItem("cinebox-recovery"), null);
  assert.notEqual(JSON.parse(storage.getItem("cinebox-titles"))[0]?.videoAssetKey, "22:video:v:old");
});

test("transaction suppression: signale un rollback impossible sans masquer l'échec", () => {
  const storage = memoryStorage({ "cinebox-titles": "catalogue-avant", "cinebox-favorites": "favoris-avant" });
  storage.setItem = (key, value) => {
    if (key === "cinebox-favorites") throw new DOMException("quota", "QuotaExceededError");
    if (key === "cinebox-titles" && value === "catalogue-avant") throw new DOMException("blocked", "SecurityError");
    storage.data.set(key, String(value));
  };

  const result = writeLocalJsonPair(() => storage, "cinebox-titles", [], "cinebox-favorites", []);
  assert.equal(result.ok, false);
  assert.equal(result.rollbackFailed, true);
  assert.equal(result.reason, "quota");
});

test("échec localStorage lors d'une suppression: aucun asset n'est nettoyé", async () => {
  const storage = memoryStorage({ "cinebox-titles": "catalogue-avant", "cinebox-favorites": "favoris-avant" });
  storage.setItem = (key, value) => {
    if (key === "cinebox-favorites") throw new DOMException("quota", "QuotaExceededError");
    storage.data.set(key, String(value));
  };
  let assetsDeleted = false;

  const result = await commitMetadataThenCleanup({
    commitMetadata: () => writeLocalJsonPair(() => storage, "cinebox-titles", [], "cinebox-favorites", []).ok,
    obsoleteKeys: ["91:video"],
    referencedKeys: new Set(),
    deleteAssets: async () => { assetsDeleted = true; },
  });

  assert.equal(result.status, "commit-failed");
  assert.equal(assetsDeleted, false);
  assert.equal(storage.getItem("cinebox-titles"), "catalogue-avant");
  assert.equal(storage.getItem("cinebox-favorites"), "favoris-avant");
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

test("commit réussi: le journal est effacé après vérification des deux nouvelles valeurs", () => {
  const storage = memoryStorage({ "cinebox-titles": JSON.stringify([{ id: 32 }]), "cinebox-favorites": "[32]" });

  const result = writeLocalJsonPair(() => storage, "cinebox-titles", [], "cinebox-favorites", []);

  assert.equal(result.ok, true);
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

test("journal invalide ou vide: les clés ne changent pas et aucune suppression ne remplace le journal", () => {
  for (const invalidJournal of ["", "{broken"]) {
    const beforeTitles = JSON.stringify([{ id: 34 }]);
    const storage = memoryStorage({ "cinebox-titles": beforeTitles, "cinebox-favorites": "[34]" });
    storage.data.set("cinebox-recovery", invalidJournal);

    const result = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
    const deletion = writeLocalJsonPair(() => storage, "cinebox-titles", [], "cinebox-favorites", []);

    assert.equal(result.status, "error");
    assert.equal(result.error.name, "LocalStorageRecoveryError");
    assert.equal(deletion.ok, false);
    assert.equal(deletion.rollbackFailed, true);
    assert.equal(storage.getItem("cinebox-recovery"), invalidJournal);
    assert.equal(storage.getItem("cinebox-titles"), beforeTitles);
    assert.equal(storage.getItem("cinebox-favorites"), "[34]");
  }

  const pending = memoryStorage({ "cinebox-titles": "[]", "cinebox-favorites": "[]" });
  installRecoveryJournal(pending, "[35]", "[35]", "[]", "[]");
  const pendingRaw = pending.getItem("cinebox-recovery");
  const blocked = writeLocalJsonPair(() => pending, "cinebox-titles", [{ id: 36 }], "cinebox-favorites", [36]);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.rollbackFailed, true);
  assert.equal(pending.getItem("cinebox-recovery"), pendingRaw);
  assert.equal(pending.getItem("cinebox-titles"), "[]");
  assert.equal(pending.getItem("cinebox-favorites"), "[]");
});

test("échec d'écriture du journal: catalogue et favoris restent exactement intacts", () => {
  const beforeTitles = JSON.stringify([{ id: 35 }]);
  const beforeFavorites = "[35]";
  const storage = memoryStorage({ "cinebox-titles": beforeTitles, "cinebox-favorites": beforeFavorites });
  const originalSetItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === "cinebox-recovery") throw new DOMException("journal quota", "QuotaExceededError");
    originalSetItem(key, value);
  };

  const result = writeLocalJsonPair(() => storage, "cinebox-titles", [], "cinebox-favorites", []);

  assert.equal(result.ok, false);
  assert.equal(result.rollbackFailed, false);
  assert.equal(storage.getItem("cinebox-titles"), beforeTitles);
  assert.equal(storage.getItem("cinebox-favorites"), beforeFavorites);
  assert.equal(storage.getItem("cinebox-recovery"), null);
});

test("les instantanés distinguent clé absente, chaîne vide, JSON et JSON invalide", () => {
  const storage = memoryStorage({ "cinebox-favorites": "" });
  const originalSetItem = storage.setItem;
  let failedPublication = false;
  storage.setItem = (key, value) => {
    if (key === "cinebox-favorites" && value === "[]" && !failedPublication) {
      failedPublication = true;
      throw new DOMException("synthetic publication error", "QuotaExceededError");
    }
    originalSetItem(key, value);
  };
  const originalRemoveItem = storage.removeItem;
  let failTitleRollback = true;
  storage.removeItem = (key) => {
    if (key === "cinebox-titles" && failTitleRollback) {
      failTitleRollback = false;
      throw new DOMException("synthetic rollback error", "SecurityError");
    }
    originalRemoveItem(key);
  };

  const result = writeLocalJsonPair(() => storage, "cinebox-titles", [], "cinebox-favorites", []);
  assert.equal(result.rollbackFailed, true);
  const journal = JSON.parse(storage.getItem("cinebox-recovery"));
  assert.deepEqual(journal.before, {
    titles: { kind: "absent" },
    favorites: { kind: "empty", raw: "" },
  });
  assert.deepEqual(journal.after, {
    titles: { kind: "json", raw: "[]" },
    favorites: { kind: "json", raw: "[]" },
  });

  const recoveredMissing = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
  assert.equal(recoveredMissing.status, "missing");
  assert.equal(storage.data.has("cinebox-titles"), false);
  assert.equal(storage.getItem("cinebox-favorites"), "");
  assert.equal(storage.getItem("cinebox-recovery"), null);

  storage.data.set("cinebox-titles", "{invalid-json");
  const invalidBefore = "{invalid-json";
  const invalidFavorites = "[]";
  storage.data.set("cinebox-titles", "[]");
  storage.data.set("cinebox-favorites", "[99]");
  installRecoveryJournal(storage, invalidBefore, invalidFavorites, "[]", "[]");
  const recovered = readLocalJson(() => storage, "cinebox-titles", isTitleArray);
  assert.equal(recovered.status, "error");
  assert.equal(recovered.reason, "parse");
  assert.equal(storage.getItem("cinebox-titles"), invalidBefore);
  assert.equal(storage.getItem("cinebox-favorites"), invalidFavorites);
  assert.equal(storage.getItem("cinebox-recovery"), null);
});
