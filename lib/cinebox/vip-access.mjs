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
 * - vip-exclusive     : only active VIP members (and administrators) can see it.
 * - early-access      : programmed release. `public_at` is mandatory and is the
 *                       instant the title opens to everyone.
 *
 * The 48-hour VIP window is a real, bounded window:
 * - before `public_at - 48h` : nobody can see or play the title ("scheduled");
 * - from `public_at - 48h` to `public_at` : active VIP members and
 *   administrators only ("early");
 * - from `public_at` : everyone ("public"), automatically.
 *
 * Fail-closed rules
 * - An invalid or missing `public_at` on an early-access title is "invalid":
 *   nobody can see it until an administrator fixes the configuration.
 * - Unknown/malformed flags never grant access.
 * - Administrators are entitled for VIP-exclusive content, because they must
 *   be able to inspect and manage the catalogue. They do NOT bypass the lower
 *   bound of a scheduled premiere on viewer surfaces.
 */

/** Duration of the VIP head-start advertised by the programme (48 hours). */
export const VIP_EARLY_ACCESS_HOURS = 48;
/** Same duration in milliseconds, used by the date and SQL predicates. */
export const VIP_EARLY_ACCESS_WINDOW_MS = VIP_EARLY_ACCESS_HOURS * 60 * 60 * 1000;

/** @typedef {"public" | "vip-exclusive" | "early-access"} VipAccessMode */
/** @typedef {"public" | "scheduled" | "early" | "vip" | "invalid"} VipAccessState */
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
 * - `scheduled` : early-access, the 48 h VIP window has not started yet;
 *                 inaccessible to everyone (including VIP members).
 * - `early`     : inside the 48 h VIP window; VIP members only.
 * - `public`    : open to everyone (always, or from `public_at`).
 * - `vip`       : VIP-exclusive title.
 * - `invalid`   : early-access title with a missing/unreadable public date.
 * @param {{ vipExclusive?: unknown, vipEarlyAccess?: unknown, publicAt?: unknown }} [row]
 * @param {number} [now]
 * @returns {VipAccessState}
 */
export function vipAccessState(row = {}, now = Date.now()) {
  const flags = normalizeVipFlags(row);
  if (flags.vipExclusive) return "vip";
  if (!flags.vipEarlyAccess) return "public";
  // Missing or invalid public date: never release the title to anyone.
  if (flags.publicAtMs === null) return "invalid";
  const windowStart = flags.publicAtMs - VIP_EARLY_ACCESS_WINDOW_MS;
  if (now < windowStart) return "scheduled";
  if (now < flags.publicAtMs) return "early";
  return "public";
}

/**
 * Start of the VIP window (`public_at - 48 h`) for an early-access row, or
 * null when the row is not a valid early-access entry.
 * @param {{ vipExclusive?: unknown, vipEarlyAccess?: unknown, publicAt?: unknown }} [row]
 * @returns {number | null}
 */
export function vipEarlyAccessStart(row = {}) {
  const flags = normalizeVipFlags(row);
  if (!flags.vipEarlyAccess || flags.publicAtMs === null) return null;
  return flags.publicAtMs - VIP_EARLY_ACCESS_WINDOW_MS;
}

/**
 * @param {ViewerEntitlements | null | undefined} viewer
 * @returns {boolean}
 */
export function viewerIsEntitled(viewer) {
  return Boolean(viewer && viewer.vip === true);
}

/**
 * True when the viewer may see the title and its media URLs.
 *
 * Only an active VIP membership grants restricted viewer access. Admins use
 * `/api/catalog/manage` to inspect restricted rows; admin status alone never
 * grants playback.
 * @param {{ vipExclusive?: unknown, vipEarlyAccess?: unknown, publicAt?: unknown }} row
 * @param {ViewerEntitlements | null | undefined} viewer
 * @param {number} [now]
 * @returns {boolean}
 */
export function canAccessContent(row, viewer, now = Date.now()) {
  const state = vipAccessState(row, now);
  if (state === "public") return true;
  if (state === "vip" || state === "early") return viewerIsEntitled(viewer);
  // "scheduled" (before the 48 h window) and "invalid" (no usable date) are
  // never readable by a viewer.
  return false;
}

/**
 * SQL predicate matching the rows a viewer is allowed to see.
 * The caller must bind `params` in order and prefix every column with `prefix`
 * when the table is not the only one in the statement.
 *
 * Dates are compared through SQLite's `datetime()` normaliser so an ISO 8601
 * UTC value, a `datetime-local` value or a legacy value cannot be mis-ordered
 * by a raw lexicographic comparison. An unreadable date yields NULL and the
 * row is filtered out (fail closed).
 *
 * Entitled viewers get the same SQL treatment as everyone else for the lower
 * bound: `vip_early_access=1` rows only appear once `public_at <= now + 48h`.
 * VIP-exclusive rows always remain visible to them.
 *
 * @param {boolean} entitled
 * @param {{ now?: string, prefix?: string }} [options]
 * @returns {{ sql: string, params: string[] }}
 */
export function catalogVisibilitySql(entitled, options = {}) {
  const prefix = typeof options.prefix === "string" ? options.prefix : "";
  const column = (name) => `${prefix}${name}`;
  // Visibility is deliberately broader than playback entitlement: every valid
  // scheduled premiere is listed so its poster and public release countdown
  // can be shown. Playback URLs are stripped separately by the sanitiser.
  const validPremiereDate = `(${column("public_at")} IS NOT NULL AND TRIM(${column("public_at")})<>'' AND datetime(${column("public_at")}) IS NOT NULL)`;
  const validPremiere = `(${column("vip_early_access")}=0 OR ${validPremiereDate})`;
  const audience = entitled
    ? `(${column("vip_exclusive")}=1 OR (${column("vip_exclusive")}=0 AND ${validPremiere}))`
    : `(${column("vip_exclusive")}=0 AND ${validPremiere})`;
  return { sql: audience, params: [] };
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
  if (state === "scheduled") return { state, mode, label: "Avant-première programmée" };
  if (state === "invalid") return { state, mode, label: "Configuration VIP invalide" };
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
 * Filter titles for catalogue display, not playback. Scheduled premieres stay
 * visible to everyone, but their media URLs are removed until the viewer is
 * entitled. VIP-exclusive rows remain hidden from non-VIP viewers.
 * @template {Record<string, any>} T
 * @param {T[]} titles
 * @param {ViewerEntitlements | null | undefined} viewer
 * @param {number} [now]
 * @returns {T[]}
 */
export function filterVisibleTitles(titles, viewer, now = Date.now()) {
  const list = Array.isArray(titles) ? titles : [];
  return list
    .filter((title) => {
      const state = vipAccessState(title, now);
      if (state === "invalid") return false;
      if (state === "vip") return viewerIsEntitled(viewer);
      return true;
    })
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
