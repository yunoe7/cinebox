/**
 * Central VIP access policy.
 *
 * This module is isomorphic: it is imported by the Pages Functions (server)
 * and by the React client. Every rule about VIP-exclusive content and the
 * 48-hour early-access window lives here so the server and the UI can never
 * drift apart.
 *
 * Vocabulary
 * - public            : everyone can see the title.
 * - vip-exclusive     : only VIP members (and administrators) can see it.
 * - early-access      : VIP members see it immediately; everyone else sees it
 *                       from `public_at` (a mandatory, absolute instant).
 *
 * Fail-closed rules
 * - An invalid or missing `public_at` on an early-access title keeps it VIP-only.
 * - Unknown/malformed flags never grant access.
 * - Administrators are always entitled, because they must be able to inspect
 *   and manage the catalogue.
 */

/** Historical duration advertised by the VIP programme (VIP sees it first). */
export const VIP_EARLY_ACCESS_HOURS = 48;

/** @typedef {"public" | "vip-exclusive" | "early-access"} VipAccessMode */
/** @typedef {"public" | "early" | "vip"} VipAccessState */
/** @typedef {{ vip?: boolean, admin?: boolean, authenticated?: boolean }} ViewerEntitlements */

/**
 * Parse a public date. Returns the epoch in milliseconds, or null when the
 * value is absent or not a finite date. Callers must treat null as "not public
 * yet" for early-access rows.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parsePublicAt(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {unknown} value */
function asFlag(value) {
  return value === true || value === 1 || value === "1";
}

/**
 * Normalise the three catalogue columns into one coherent shape.
 * `vipExclusive` always wins over `vipEarlyAccess`: the database constraint
 * forbids both, but a malformed row must never be interpreted as public.
 * @param {{ vipExclusive?: unknown, vipEarlyAccess?: unknown, publicAt?: unknown }} [row]
 * @returns {{ vipExclusive: boolean, vipEarlyAccess: boolean, publicAt: string | null, publicAtMs: number | null }}
 */
export function normalizeVipFlags(row = {}) {
  const vipExclusive = asFlag(row.vipExclusive);
  const vipEarlyAccess = !vipExclusive && asFlag(row.vipEarlyAccess);
  const publicAt = typeof row.publicAt === "string" && row.publicAt.trim() ? row.publicAt : null;
  return {
    vipExclusive,
    vipEarlyAccess,
    publicAt,
    publicAtMs: parsePublicAt(publicAt),
  };
}

/**
 * @param {{ vipExclusive?: unknown, vipEarlyAccess?: unknown, publicAt?: unknown }} [row]
 * @returns {VipAccessMode}
 */
export function accessMode(row = {}) {
  const flags = normalizeVipFlags(row);
  if (flags.vipExclusive) return "vip-exclusive";
  if (flags.vipEarlyAccess) return "early-access";
  return "public";
}

/**
 * Current audience of a title at a given instant.
 * `early` means "VIP only, public date not reached yet".
 * @param {{ vipExclusive?: unknown, vipEarlyAccess?: unknown, publicAt?: unknown }} [row]
 * @param {number} [now]
 * @returns {VipAccessState}
 */
export function vipAccessState(row = {}, now = Date.now()) {
  const flags = normalizeVipFlags(row);
  if (flags.vipExclusive) return "vip";
  if (!flags.vipEarlyAccess) return "public";
  // Missing or invalid public date: never release to non-VIP viewers.
  if (flags.publicAtMs === null) return "vip";
  return flags.publicAtMs > now ? "early" : "public";
}

/**
 * @param {ViewerEntitlements | null | undefined} viewer
 * @returns {boolean}
 */
export function viewerIsEntitled(viewer) {
  return Boolean(viewer && (viewer.admin === true || viewer.vip === true));
}

/**
 * True when the viewer may see the title and its media URLs.
 * @param {{ vipExclusive?: unknown, vipEarlyAccess?: unknown, publicAt?: unknown }} row
 * @param {ViewerEntitlements | null | undefined} viewer
 * @param {number} [now]
 * @returns {boolean}
 */
export function canAccessContent(row, viewer, now = Date.now()) {
  if (viewerIsEntitled(viewer)) return true;
  return vipAccessState(row, now) === "public";
}

/**
 * SQL predicate matching the rows a viewer is allowed to see.
 * The caller must bind `params` in order and prefix every column with `prefix`
 * when the table is not the only one in the statement.
 *
 * String comparison is safe because every stored date is normalised to ISO
 * 8601 UTC by the administration routes.
 *
 * @param {boolean} entitled
 * @param {{ now?: string, prefix?: string }} [options]
 * @returns {{ sql: string, params: string[] }}
 */
export function catalogVisibilitySql(entitled, options = {}) {
  if (entitled) return { sql: "1=1", params: [] };
  const prefix = typeof options.prefix === "string" ? options.prefix : "";
  const column = (name) => `${prefix}${name}`;
  return {
    sql: `${column("vip_exclusive")}=0 AND (${column("vip_early_access")}=0 OR (${column("public_at")} IS NOT NULL AND TRIM(${column("public_at")})<>'' AND ${column("public_at")}<=?))`,
    params: [typeof options.now === "string" && options.now ? options.now : new Date().toISOString()],
  };
}

/**
 * Validate an administration payload before writing it to D1.
 *
 * Rules:
 * - both booleans, explicitly provided;
 * - exclusive and early access are mutually exclusive;
 * - early access requires a valid public date;
 * - exclusive and public modes always clear the public date;
 * - the returned date is normalised to ISO 8601 UTC.
 *
 * @param {{ vipExclusive?: unknown, vipEarlyAccess?: unknown, publicAt?: unknown }} input
 * @returns {{ ok: true, value: { vipExclusive: boolean, vipEarlyAccess: boolean, publicAt: string | null } } | { ok: false, error: string }}
 */
export function validateVipSettings(input = {}) {
  if (typeof input.vipExclusive !== "boolean") {
    return { ok: false, error: "Le réglage « exclusif VIP » doit être un booléen." };
  }
  if (typeof input.vipEarlyAccess !== "boolean") {
    return { ok: false, error: "Le réglage « avant-première VIP » doit être un booléen." };
  }
  if (input.vipExclusive && input.vipEarlyAccess) {
    return { ok: false, error: "Un titre ne peut pas être exclusif VIP et en avant-première simultanément." };
  }

  if (!input.vipEarlyAccess) {
    return { ok: true, value: { vipExclusive: input.vipExclusive, vipEarlyAccess: false, publicAt: null } };
  }

  if (input.publicAt === null || input.publicAt === undefined || input.publicAt === "") {
    return { ok: false, error: "Une date et une heure d’ouverture au public sont obligatoires pour une avant-première VIP." };
  }
  const parsed = parsePublicAt(input.publicAt);
  if (parsed === null) {
    return { ok: false, error: "La date d’ouverture au public est invalide." };
  }
  return {
    ok: true,
    value: { vipExclusive: false, vipEarlyAccess: true, publicAt: new Date(parsed).toISOString() },
  };
}

/**
 * Human-readable status, safe to display in the admin UI and on cards.
 * The label is French because CinéBox is a French application.
 * @param {{ vipExclusive?: unknown, vipEarlyAccess?: unknown, publicAt?: unknown }} row
 * @param {number} [now]
 * @returns {{ state: VipAccessState, mode: VipAccessMode, label: string }}
 */
export function vipStatusLabel(row = {}, now = Date.now()) {
  const state = vipAccessState(row, now);
  const mode = accessMode(row);
  if (mode === "vip-exclusive") return { state, mode, label: "Exclusif VIP" };
  if (mode === "public") return { state, mode, label: "Public" };
  if (state === "public") return { state, mode, label: "Public — avant-première terminée" };
  return { state, mode, label: "Avant-première VIP" };
}

/**
 * Remove every playable URL from a title that the viewer may not access.
 * Defence in depth: the API must already have filtered the row out, but a
 * stale client cache/response must never hand a video URL to a non-entitled
 * viewer.
 * @template {Record<string, any>} T
 * @param {T} title
 * @param {ViewerEntitlements | null | undefined} viewer
 * @param {number} [now]
 * @returns {T}
 */
export function sanitizeTitleForViewer(title, viewer, now = Date.now()) {
  if (!title || typeof title !== "object" || canAccessContent(title, viewer, now)) return title;
  const clone = { ...title };
  delete clone.videoUrl;
  delete clone.sources;
  if (Array.isArray(clone.seasons)) {
    clone.seasons = clone.seasons.map((season) => ({
      ...season,
      episodes: Array.isArray(season.episodes)
        ? season.episodes.map((episode) => {
            const safe = { ...episode };
            delete safe.videoUrl;
            delete safe.sources;
            return safe;
          })
        : [],
    }));
  }
  return clone;
}

/**
 * Filter a mixed catalogue (personal + shared) with the same server policy.
 * @template {Record<string, any>} T
 * @param {T[]} titles
 * @param {ViewerEntitlements | null | undefined} viewer
 * @param {number} [now]
 * @returns {T[]}
 */
export function filterAccessibleTitles(titles, viewer, now = Date.now()) {
  const list = Array.isArray(titles) ? titles : [];
  return list
    .filter((title) => canAccessContent(title, viewer, now))
    .map((title) => sanitizeTitleForViewer(title, viewer, now));
}

/**
 * Copy the authoritative VIP flags from the shared catalogue onto matching
 * personal titles.
 *
 * A user may have an old personal copy of a title that is now VIP-restricted.
 * The shared catalogue is the source of truth, so the local copy inherits its
 * flags before the client-side access filter runs.
 *
 * @template {Record<string, any>} T
 * @template {Record<string, any>} S
 * @param {T[]} localTitles
 * @param {S[]} sharedTitles
 * @returns {T[]}
 */
export function applySharedVipRestrictions(localTitles, sharedTitles) {
  const local = Array.isArray(localTitles) ? localTitles : [];
  const shared = Array.isArray(sharedTitles) ? sharedTitles : [];
  if (!shared.length) return local;

  const bySharedId = new Map();
  const byTmdb = new Map();
  for (const item of shared) {
    if (typeof item?.sharedId === "string" && item.sharedId) bySharedId.set(item.sharedId, item);
    if (typeof item?.tmdbId === "number" && Number.isFinite(item.tmdbId)) {
      byTmdb.set(`${item.kind}:${item.tmdbId}`, item);
    }
  }

  return local.map((title) => {
    const match = (typeof title?.sharedId === "string" && title.sharedId ? bySharedId.get(title.sharedId) : null)
      || (typeof title?.tmdbId === "number" && Number.isFinite(title.tmdbId) ? byTmdb.get(`${title.kind}:${title.tmdbId}`) : null);
    if (!match) return title;
    return {
      ...title,
      vipExclusive: match.vipExclusive === true,
      vipEarlyAccess: match.vipEarlyAccess === true,
      publicAt: typeof match.publicAt === "string" ? match.publicAt : undefined,
    };
  });
}
