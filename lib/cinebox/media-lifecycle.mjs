/**
 * Stage every asset under a fresh, immutable key. Partial success is reported
 * without attempting cleanup because no staged key has been published yet.
 * @param {Array<{slot: string, baseKey: string, blob: Blob}>} assets
 * @param {(baseKey: string, blob: Blob) => Promise<string>} saveVersionedAsset
 */
export async function stageAssets(assets, saveVersionedAsset) {
  const settled = await Promise.allSettled(assets.map(async ({ slot, baseKey, blob }) => [slot, await saveVersionedAsset(baseKey, blob)]));
  const references = Object.fromEntries(settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value));
  const failure = settled.find((entry) => entry.status === "rejected");
  return failure
    ? { status: "failed", references, error: failure.reason }
    : { status: "ready", references };
}

/**
 * Delete only freshly staged, unpublished versioned keys that are absent from
 * the currently validated reference set. If references cannot be trusted,
 * leave every candidate in place.
 * @param {string[]} candidateKeys Exact successful keys returned by stageAssets.
 * @param {() => Set<string> | Promise<Set<string>>} readReferencedKeys
 * @param {(keys: string[]) => Promise<void>} deleteAssets
 */
export async function cleanupUnpublishedAssets(candidateKeys, readReferencedKeys, deleteAssets) {
  if (!Array.isArray(candidateKeys)) {
    return { status: "references-unavailable", candidateKeys: [], error: new Error("La liste des clés à nettoyer est invalide.") };
  }
  const candidates = [...new Set(candidateKeys)];
  if (candidates.some((key) => typeof key !== "string" || !key.includes(":v:"))) {
    return { status: "references-unavailable", candidateKeys: candidates, error: new Error("Les clés à nettoyer ne sont pas des clés versionnées de staging.") };
  }
  if (candidates.length === 0) return { status: "cleaned", deletedKeys: [], retainedKeys: [] };

  let referencedKeys;
  try {
    referencedKeys = await readReferencedKeys();
  } catch (error) {
    return { status: "references-unavailable", candidateKeys: candidates, error };
  }
  if (!(referencedKeys instanceof Set) || [...referencedKeys].some((key) => typeof key !== "string")) {
    return { status: "references-unavailable", candidateKeys: candidates, error: new Error("Les références actives n’ont pas pu être validées.") };
  }

  const deletableKeys = candidates.filter((key) => !referencedKeys.has(key));
  const retainedKeys = candidates.filter((key) => referencedKeys.has(key));
  if (deletableKeys.length === 0) return { status: "cleaned", deletedKeys: [], retainedKeys };

  try {
    await deleteAssets(deletableKeys);
    return { status: "cleaned", deletedKeys: deletableKeys, retainedKeys };
  } catch (error) {
    return { status: "cleanup-failed", unresolvedKeys: deletableKeys, retainedKeys, error };
  }
}

/**
 * Persist metadata first; only then delete exact, known obsolete keys.
 * @param {{commitMetadata: () => boolean | Promise<boolean>, obsoleteKeys: string[], referencedKeys: Set<string>, deleteAssets: (keys: string[]) => Promise<void>}} options
 */
export async function commitMetadataThenCleanup({ commitMetadata, obsoleteKeys, referencedKeys, deleteAssets }) {
  let committed;
  try {
    committed = await commitMetadata();
  } catch (error) {
    return { status: "commit-failed", error };
  }
  if (!committed) return { status: "commit-failed" };

  const retiredKeys = [...new Set(obsoleteKeys)].filter((key) => !referencedKeys.has(key));
  if (retiredKeys.length === 0) return { status: "committed", retiredKeys };

  try {
    await deleteAssets(retiredKeys);
    return { status: "committed", retiredKeys };
  } catch (error) {
    return { status: "cleanup-failed", retiredKeys, error };
  }
}
