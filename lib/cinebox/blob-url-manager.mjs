const entries = new Map();
const owners = new Map();

function isManagedBlobUrl(url) {
  return typeof url === "string" && url.startsWith("blob:") && entries.has(url);
}

function hasOwners(entry) {
  return entry.durableOwners.size > 0 || entry.provisionalOwners.size > 0 || entry.leases.size > 0;
}

function scheduleRevocation(entry) {
  if (entry.revoked || entry.revocationScheduled || hasOwners(entry)) return;
  entry.revocationScheduled = true;
  const generation = ++entry.generation;
  queueMicrotask(() => {
    if (entry.generation !== generation) return;
    entry.revocationScheduled = false;
    if (entry.revoked || hasOwners(entry)) return;
    entry.revoked = true;
    try { URL.revokeObjectURL(entry.url); } catch { /* Native revoke is idempotent; keep teardown non-throwing. */ }
    entries.delete(entry.url);
  });
}

function cancelRevocation(entry) {
  entry.generation += 1;
  entry.revocationScheduled = false;
}

function createEntry(blob, provisionalOwner) {
  let url;
  try {
    url = URL.createObjectURL(blob);
  } catch (error) {
    throw error;
  }
  const entry = {
    url,
    durableOwners: new Set(),
    provisionalOwners: new Set([provisionalOwner]),
    leases: new Set(),
    generation: 0,
    revocationScheduled: false,
    revoked: false,
  };
  entries.set(url, entry);
  return entry;
}

function addDurableOwner(ownerId, url) {
  const entry = entries.get(url);
  if (!entry || entry.revoked) return;
  cancelRevocation(entry);
  entry.durableOwners.add(ownerId);
  let urls = owners.get(ownerId);
  if (!urls) owners.set(ownerId, urls = new Set());
  urls.add(url);
}

function releaseDurableOwner(ownerId, url) {
  const entry = entries.get(url);
  entry?.durableOwners.delete(ownerId);
  const urls = owners.get(ownerId);
  urls?.delete(url);
  if (urls?.size === 0) owners.delete(ownerId);
  if (entry) scheduleRevocation(entry);
}

export function syncBlobUrlOwner(ownerId, urls) {
  if (typeof ownerId !== "string" || !ownerId) throw new TypeError("Un propriétaire d’URL Blob doit avoir un identifiant.");
  const next = new Set([...urls].filter(isManagedBlobUrl));
  const previous = owners.get(ownerId) || new Set();
  for (const url of next) addDurableOwner(ownerId, url);
  for (const url of previous) if (!next.has(url)) releaseDurableOwner(ownerId, url);
  if (next.size === 0) owners.delete(ownerId);
}

export function clearBlobUrlOwner(ownerId) {
  syncBlobUrlOwner(ownerId, []);
}

export function createBlobUrlLease(blob) {
  const token = Symbol("blob-url-lease");
  const entry = createEntry(blob, token);
  entry.provisionalOwners.delete(token);
  return retainBlobUrl(entry.url);
}

export function retainBlobUrl(url) {
  const entry = entries.get(url);
  if (!entry || entry.revoked) return { url, release() {} };
  const token = Symbol("blob-url-user");
  cancelRevocation(entry);
  entry.leases.add(token);
  let released = false;
  return {
    url,
    release() {
      if (released) return;
      released = true;
      entry.leases.delete(token);
      scheduleRevocation(entry);
    },
  };
}

export function createProvisionalBlobUrlBatch() {
  const token = Symbol("blob-url-batch");
  const urls = new Set();
  let state = "open";
  const release = () => {
    if (state !== "open") return;
    state = "released";
    for (const url of urls) {
      const entry = entries.get(url);
      entry?.provisionalOwners.delete(token);
      if (entry) scheduleRevocation(entry);
    }
    urls.clear();
  };
  return {
    create(blob) {
      if (state !== "open") throw new Error("Le lot d’URL Blob n’est plus ouvert.");
      try {
        const entry = createEntry(blob, token);
        urls.add(entry.url);
        return entry.url;
      } catch (error) {
        release();
        throw error;
      }
    },
    get urls() { return [...urls]; },
    transferTo(ownerId) {
      if (state !== "open") return false;
      for (const url of urls) addDurableOwner(ownerId, url);
      for (const url of urls) {
        const entry = entries.get(url);
        entry?.provisionalOwners.delete(token);
      }
      state = "transferred";
      return true;
    },
    release,
  };
}

