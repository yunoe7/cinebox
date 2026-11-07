const ASSET_DB = "cinebox-assets";
const ASSET_STORE = "files";

export type AssetReadResult = { status: "found"; blob: Blob } | { status: "missing" };

function createVersionedKey(baseKey: string): string {
  const token = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${baseKey}:v:${token}`;
}

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DB, 1);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ASSET_STORE)) {
        request.result.createObjectStore(ASSET_STORE);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Impossible d'ouvrir le stockage local."));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Le stockage local est bloqué par un autre onglet."));
    };
  });
}

/** Stores a new immutable version and returns its key without touching the legacy key. */
export async function saveVersionedAsset(baseKey: string, file: Blob): Promise<string> {
  const versionedKey = createVersionedKey(baseKey);
  const db = await openAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      tx.objectStore(ASSET_STORE).add(file, versionedKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Échec de l'enregistrement du fichier."));
      tx.onabort = () => reject(tx.error ?? new Error("Enregistrement du fichier annulé."));
    });
    return versionedKey;
  } finally {
    db.close();
  }
}

/** Returns missing only after a successful IndexedDB read; operational errors reject. */
export async function readAsset(key: string): Promise<AssetReadResult> {
  const db = await openAssetDb();
  try {
    return await new Promise<AssetReadResult>((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, "readonly");
      const request = tx.objectStore(ASSET_STORE).get(key);
      let blob: Blob | undefined;
      request.onsuccess = () => { blob = request.result as Blob | undefined; };
      request.onerror = () => reject(request.error ?? new Error("Échec de lecture du fichier."));
      tx.oncomplete = () => resolve(blob === undefined ? { status: "missing" } : { status: "found", blob });
      tx.onerror = () => reject(tx.error ?? new Error("Échec de lecture du fichier."));
      tx.onabort = () => reject(tx.error ?? new Error("Lecture du fichier annulée."));
    });
  } finally {
    db.close();
  }
}

/** Deletes only the exact keys supplied after their metadata references are retired. */
export async function deleteAssetKeys(keys: readonly string[]): Promise<void> {
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length === 0) return;
  const db = await openAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      const store = tx.objectStore(ASSET_STORE);
      for (const key of uniqueKeys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Échec du nettoyage des fichiers."));
      tx.onabort = () => reject(tx.error ?? new Error("Nettoyage des fichiers annulé."));
    });
  } finally {
    db.close();
  }
}
