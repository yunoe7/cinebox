const ASSET_DB = "cinebox-assets";
const ASSET_STORE = "files";

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ASSET_STORE)) {
        request.result.createObjectStore(ASSET_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Impossible d'ouvrir le stockage local."));
    request.onblocked = () => reject(new Error("Le stockage local est bloqué par un autre onglet."));
  });
}

export async function saveAsset(key: string, file: Blob): Promise<void> {
  const db = await openAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      tx.objectStore(ASSET_STORE).put(file, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Échec de l'enregistrement du fichier."));
      tx.onabort = () => reject(tx.error ?? new Error("Enregistrement du fichier annulé."));
    });
  } finally {
    db.close();
  }
}

export async function loadAsset(key: string): Promise<Blob | undefined> {
  const db = await openAssetDb();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).get(key);
      request.onsuccess = () => resolve(request.result as Blob | undefined);
      request.onerror = () => reject(request.error ?? new Error("Échec de lecture du fichier."));
    });
  } finally {
    db.close();
  }
}

export async function deleteAssets(id: number): Promise<void> {
  const db = await openAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, "readwrite");
      const store = tx.objectStore(ASSET_STORE);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result) {
          if (typeof key === "string" && key.startsWith(`${id}:`)) store.delete(key);
        }
      };
      keys.onerror = () => tx.abort();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Échec du nettoyage des fichiers."));
      tx.onabort = () => reject(tx.error ?? new Error("Nettoyage des fichiers annulé."));
    });
  } finally {
    db.close();
  }
}
