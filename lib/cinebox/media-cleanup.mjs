const DB_NAME = "cinebox-cleanup";
const STORE_NAME = "jobs";
const LOCK_NAME = "cinebox-media-references";
const JOB_VERSION = 1;

function openCleanupDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Impossible d’ouvrir le journal de nettoyage."));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Le journal de nettoyage est bloqué par un autre onglet."));
    };
  });
}

function transaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    let result;
    const tx = db.transaction(STORE_NAME, mode);
    try {
      result = action(tx.objectStore(STORE_NAME));
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result && typeof result === "object" && "result" in result ? result.result : result);
    tx.onerror = () => reject(tx.error ?? new Error("Échec de transaction du journal de nettoyage."));
    tx.onabort = () => reject(tx.error ?? new Error("Transaction du journal de nettoyage annulée."));
  });
}

function sealFor(job) {
  const payload = JSON.stringify({
    version: job.version,
    id: job.id,
    createdAt: job.createdAt,
    operation: job.operation,
    keys: job.keys,
  });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function validJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job) ||
      Object.keys(job).sort().join(",") !== "createdAt,id,keys,operation,seal,version" ||
      job.version !== JOB_VERSION || typeof job.id !== "string" || !job.id.length ||
      typeof job.createdAt !== "string" || Number.isNaN(Date.parse(job.createdAt)) ||
      typeof job.operation !== "string" || !job.operation.length || !Array.isArray(job.keys) || !job.keys.length ||
      job.keys.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).sort().join(",") !== "key,state" || typeof entry.key !== "string" || !entry.key.length ||
        !["pending", "deleted", "retained"].includes(entry.state)) ||
      new Set(job.keys.map((entry) => entry.key)).size !== job.keys.length) return false;
  return typeof job.seal === "string" && job.seal === sealFor(job);
}

function makeId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function withMediaReferencesLock(callback, locks = globalThis.navigator?.locks) {
  if (!locks || typeof locks.request !== "function") return { status: "deferred", reason: "locks-unavailable" };
  try {
    const value = await locks.request(LOCK_NAME, { mode: "exclusive" }, callback);
    return { status: "locked", value };
  } catch (error) {
    return { status: "failed", error };
  }
}

export async function createMediaCleanupJob(keys, operation) {
  if (!Array.isArray(keys) || typeof operation !== "string" || !operation.trim()) {
    throw new Error("Le travail de nettoyage est invalide.");
  }
  const candidates = [...new Set(keys)];
  if (!candidates.length) return null;
  if (candidates.some((key) => typeof key !== "string" || !key.length)) {
    throw new Error("Le travail contient une clé média invalide.");
  }
  const job = {
    version: JOB_VERSION,
    id: makeId(),
    createdAt: new Date().toISOString(),
    operation: operation.trim(),
    keys: candidates.map((key) => ({ key, state: "pending" })),
  };
  job.seal = sealFor(job);
  const db = await openCleanupDb();
  try {
    await transaction(db, "readwrite", (store) => store.add(job));
  } finally {
    db.close();
  }
  return job;
}

export async function readMediaCleanupJobs() {
  const db = await openCleanupDb();
  try {
    return await transaction(db, "readonly", (store) => store.getAll());
  } finally {
    db.close();
  }
}

async function saveJob(job) {
  job.seal = sealFor(job);
  const db = await openCleanupDb();
  try {
    await transaction(db, "readwrite", (store) => store.put(job));
  } finally {
    db.close();
  }
}

async function removeJob(id) {
  const db = await openCleanupDb();
  try {
    await transaction(db, "readwrite", (store) => store.delete(id));
  } finally {
    db.close();
  }
}

async function processOneJob(job, { readReferencedKeys, deleteAssets }) {
  if (!validJob(job)) return { status: "corrupt", jobId: job?.id };
  let referencedKeys;
  try {
    referencedKeys = await readReferencedKeys();
  } catch (error) {
    return { status: "deferred", jobId: job.id, error };
  }
  if (!(referencedKeys instanceof Set) || [...referencedKeys].some((key) => typeof key !== "string")) {
    return { status: "deferred", jobId: job.id, error: new Error("Le catalogue actif ne peut pas être validé.") };
  }

  for (let index = 0; index < job.keys.length; index += 1) {
    if (job.keys[index].state !== "pending") continue;
    const key = job.keys[index].key;
    if (referencedKeys.has(key)) {
      job.keys[index] = { key, state: "retained" };
      try { await saveJob(job); } catch (error) { return { status: "deferred", jobId: job.id, error }; }
      continue;
    }
    try {
      await deleteAssets([key]);
    } catch (error) {
      return { status: "deferred", jobId: job.id, error };
    }
    job.keys[index] = { key, state: "deleted" };
    try { await saveJob(job); } catch (error) { return { status: "deferred", jobId: job.id, error }; }
  }

  if (!job.keys.every((entry) => entry.state === "deleted" || entry.state === "retained")) {
    return { status: "deferred", jobId: job.id, error: new Error("Le travail contient des clés non résolues.") };
  }
  try {
    await removeJob(job.id);
    return { status: "completed", jobId: job.id };
  } catch (error) {
    return { status: "deferred", jobId: job.id, error };
  }
}

/** Caller must hold the shared media-reference lock. */
export async function processMediaCleanupJobsLocked(options) {
  let jobs;
  try { jobs = await readMediaCleanupJobs(); }
  catch (error) { return { status: "deferred", results: [], error }; }
  const results = [];
  for (const job of jobs) {
    results.push(await processOneJob(job, options));
  }
  return {
    status: results.every((result) => result.status === "completed") ? "completed" : "incomplete",
    results,
  };
}

export async function processMediaCleanupJobs(options) {
  const locked = await withMediaReferencesLock(() => processMediaCleanupJobsLocked(options));
  if (locked.status === "deferred") return { status: "deferred", results: [], reason: locked.reason };
  if (locked.status === "failed") return { status: "incomplete", results: [], error: locked.error };
  return locked.value;
}

/** Write-ahead cleanup record and metadata publication within the shared lock. */
export async function publishWithMediaCleanupJournal({
  obsoleteKeys,
  operation,
  commitMetadata,
  readReferencedKeys,
  deleteAssets,
}) {
  const locked = await withMediaReferencesLock(async () => {
    let currentReferences;
    try { currentReferences = await readReferencedKeys(); }
    catch (error) { return { status: "catalog-unavailable", error }; }
    if (!(currentReferences instanceof Set) || [...currentReferences].some((key) => typeof key !== "string")) {
      return { status: "catalog-unavailable", error: new Error("Le catalogue courant ne peut pas être validé.") };
    }
    let job;
    try { job = await createMediaCleanupJob(obsoleteKeys, operation); }
    catch (error) { return { status: "journal-failed", error }; }

    let committed;
    try { committed = await commitMetadata(); }
    catch (error) { return { status: "commit-failed", jobId: job?.id, error }; }
    if (!committed) return { status: "commit-failed", jobId: job?.id };
    if (!job) return { status: "committed", cleanup: { status: "completed", results: [] } };

    const cleanup = await processOneJob(job, { readReferencedKeys, deleteAssets });
    return cleanup.status === "completed"
      ? { status: "committed", jobId: job.id, cleanup: { status: "completed", results: [cleanup] } }
      : { status: "cleanup-pending", jobId: job.id, cleanup: { status: "incomplete", results: [cleanup] } };
  });
  if (locked.status === "deferred") return { status: "deferred", reason: locked.reason };
  if (locked.status === "failed") return { status: "deferred", error: locked.error };
  return locked.value;
}
