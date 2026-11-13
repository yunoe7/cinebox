/**
 * Media source helpers (Uqload / VidMoly preparation, LOT 8).
 *
 * Pure functions only. Nothing here performs a network call, an upload or a
 * transcoding request: the module validates and normalises the fields that the
 * future upload flow will store in D1 (`catalog_media_sources`).
 *
 * A playback URL is always derived from a valid provider file code. A caller
 * can never inject an arbitrary or invented link. Several sources can target
 * the same film or episode; `selectPrimarySource` only chooses which one to
 * play.
 */

export const MEDIA_SOURCE_PROVIDERS = ["uqload", "vidmoly"];
export const MEDIA_ENCODING_STATUSES = ["pending", "processing", "ready", "failed"];
export const DEFAULT_ENCODING_STATUS = "pending";

const FILE_CODE_PATTERN = /^[A-Za-z0-9]{6,64}$/;

/**
 * Canonical playback host and accepted public hosts for every supported
 * provider. The canonical host is what `buildPlaybackUrl` emits; the accepted
 * hosts are only used to read an existing URL without any network access.
 */
const PROVIDER_CONFIG = {
  uqload: {
    // uqload.to no longer resolves (no A/AAAA record). The .com/.is/.co
    // domains redirect to uqload.vc, which is the current official host.
    playbackBase: "https://uqload.vc",
    hosts: ["uqload.vc", "uqload.to", "uqload.com", "uqload.is", "uqload.co"],
  },
  vidmoly: {
    // Several official hosts serve the same player. `.org` and `.biz` are the
    // current embed hosts, `.to` is the historical canonical one. `.me` and
    // `.com` still redirect, but an embed URL on `.me` becomes
    // `embed-embed-…` after redirect, so those two are never preserved.
    playbackBase: "https://vidmoly.to",
    hosts: ["vidmoly.to", "vidmoly.org", "vidmoly.biz", "vidmoly.net", "vidmoly.me", "vidmoly.com"],
    preservableHosts: ["vidmoly.to", "vidmoly.org", "vidmoly.biz", "vidmoly.net"],
  },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROVIDER_URL_PATTERNS = Object.fromEntries(
  Object.entries(PROVIDER_CONFIG).map(([provider, config]) => [
    provider,
    new RegExp(
      `^https?:\\/\\/(?:www\\.)?(${config.hosts.map(escapeRegExp).join("|")})\\/(?:embed-)?([A-Za-z0-9]{6,64})(?:\\.html)?\\/?(?:[?#].*)?$`,
      "i",
    ),
  ]),
);

/**
 * @param {unknown} value
 * @returns {"uqload" | "vidmoly" | null}
 */
export function normalizeProvider(value) {
  if (typeof value !== "string") return null;
  const provider = value.trim().toLocaleLowerCase("en");
  return MEDIA_SOURCE_PROVIDERS.includes(provider) ? provider : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeFileCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().replace(/\.html$/i, "");
  return FILE_CODE_PATTERN.test(code) ? code : null;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string | null}
 */
export function normalizeVideoId(value, fallback = "") {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 128);
  const code = normalizeFileCode(fallback);
  return code;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeQuality(value) {
  if (typeof value !== "string") return null;
  const quality = value.trim().slice(0, 24);
  return quality || null;
}

/**
 * @param {unknown} value
 * @returns {"pending" | "processing" | "ready" | "failed"}
 */
export function normalizeEncodingStatus(value) {
  if (typeof value !== "string") return DEFAULT_ENCODING_STATUS;
  const status = value.trim().toLocaleLowerCase("en");
  return MEDIA_ENCODING_STATUSES.includes(status) ? status : DEFAULT_ENCODING_STATUS;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeUploadedAt(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeAssociationId(value) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id ? id.slice(0, 200) : null;
}

/**
 * Derives the only accepted playback URL from a provider file code.
 * Uqload stays the default so existing callers keep their historical behaviour.
 * The optional `host` is only honoured for Vidmoly hosts known to serve the
 * player directly, so a URL copied from `vidmoly.org` keeps working instead of
 * being silently rewritten to another domain.
 *
 * @param {unknown} fileCode
 * @param {unknown} [provider]
 * @param {unknown} [host]
 * @returns {string | null}
 */
export function buildPlaybackUrl(fileCode, provider = "uqload", host = null) {
  const normalizedProvider = normalizeProvider(provider);
  const code = normalizeFileCode(fileCode);
  if (!normalizedProvider || !code) return null;
  const config = PROVIDER_CONFIG[normalizedProvider];
  const requestedHost = typeof host === "string"
    ? host.trim().toLocaleLowerCase("en").replace(/^www\./, "")
    : null;
  const base = requestedHost && (config.preservableHosts || []).includes(requestedHost)
    ? `https://${requestedHost}`
    : config.playbackBase;
  return `${base}/embed-${code}.html`;
}

/**
 * Reads any supported provider page or embed URL without any network access.
 * The provider host is returned so callers can keep a valid Vidmoly mirror.
 *
 * @param {unknown} value
 * @returns {{ provider: "uqload" | "vidmoly", fileCode: string, host: string } | null}
 */
export function parseMediaSourceUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  for (const provider of MEDIA_SOURCE_PROVIDERS) {
    const match = trimmed.match(PROVIDER_URL_PATTERNS[provider]);
    if (!match) continue;
    const fileCode = normalizeFileCode(match[2]);
    if (fileCode) return { provider, fileCode, host: match[1].toLocaleLowerCase("en") };
  }
  return null;
}

/**
 * Reads a Uqload page or embed URL without any network access.
 * @param {unknown} value
 * @returns {{ provider: "uqload", fileCode: string } | null}
 */
export function parseUqloadUrl(value) {
  const parsed = parseMediaSourceUrl(value);
  return parsed?.provider === "uqload" ? parsed : null;
}

/**
 * Reads a VidMoly page or embed URL without any network access.
 * @param {unknown} value
 * @returns {{ provider: "vidmoly", fileCode: string } | null}
 */
export function parseVidMolyUrl(value) {
  const parsed = parseMediaSourceUrl(value);
  return parsed?.provider === "vidmoly" ? parsed : null;
}

/**
 * Maps Uqload's `canplay` flag to a CinéBox encoding status.
 *
 * Uqload reports `canplay: 1` once a file is playable and `0` while it is
 * still being encoded. A missing or non-numeric value is unknown, so it stays
 * `pending` instead of pretending the file is ready.
 *
 * @param {unknown} value
 * @returns {"ready" | "processing" | "pending"}
 */
export function encodingStatusFromCanplay(value) {
  if (value === null || value === undefined || value === "") return "pending";
  const canplay = Number(value);
  if (!Number.isFinite(canplay)) return "pending";
  return canplay > 0 ? "ready" : "processing";
}

/**
 * Rewrites a stored playback URL to a canonical provider host without any
 * network access. Legacy Uqload rows (.to/.com/.is/.co) are mapped to
 * uqload.vc at read time, so existing D1 data keeps working without a
 * migration and without being modified. Vidmoly keeps a host that serves the
 * player directly (`.org`, `.biz`, `.to`, `.net`); `.me` and `.com` are
 * rewritten because their redirect doubles the `embed-` prefix.
 *
 * Non-provider values (blob:, direct files, Vidsrc, ...) are returned trimmed
 * and unchanged. An empty or non-string value returns null.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizePlaybackUrl(value) {
  const parsed = parseMediaSourceUrl(value);
  if (parsed) return buildPlaybackUrl(parsed.fileCode, parsed.provider, parsed.host);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Normalises a media source record before it is stored in D1.
 * Returns null instead of fabricating a source when required fields are invalid.
 *
 * The provider can be supplied explicitly or inferred from a supported URL.
 * When it is explicit, a URL belonging to another provider is rejected so a
 * Uqload record can never silently become a VidMoly one (or the reverse).
 *
 * @param {unknown} input
 * @returns {{
 *   titleId: string,
 *   episodeId: string | null,
 *   provider: "uqload" | "vidmoly",
 *   fileCode: string,
 *   videoId: string,
 *   playbackUrl: string,
 *   quality: string | null,
 *   encodingStatus: "pending" | "processing" | "ready" | "failed",
 *   uploadedAt: string | null,
 * } | null}
 */
export function createMediaSource(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = /** @type {Record<string, unknown>} */ (input);
  const rawProvider = record.provider ?? record.provider_id;
  const hasExplicitProvider = rawProvider !== undefined && rawProvider !== null && rawProvider !== "";
  const explicitProvider = hasExplicitProvider ? normalizeProvider(rawProvider) : null;
  if (hasExplicitProvider && !explicitProvider) return null;

  const titleId = normalizeAssociationId(record.titleId ?? record.title_id);
  const rawFileCode = record.fileCode ?? record.file_code;
  const rawPlaybackUrl = record.playbackUrl ?? record.playback_url;
  const parsed = parseMediaSourceUrl(rawFileCode) ?? parseMediaSourceUrl(rawPlaybackUrl);
  const provider = explicitProvider ?? parsed?.provider ?? "uqload";
  if (parsed && parsed.provider !== provider) return null;

  const fileCode = normalizeFileCode(rawFileCode) || parsed?.fileCode || null;
  const playbackUrl = fileCode
    ? buildPlaybackUrl(fileCode, provider, parsed?.provider === provider ? parsed.host : null)
    : null;
  if (!titleId || !fileCode || !playbackUrl) return null;
  return {
    titleId,
    episodeId: normalizeAssociationId(record.episodeId ?? record.episode_id),
    provider,
    fileCode,
    videoId: normalizeVideoId(record.videoId ?? record.video_id, fileCode) || fileCode,
    playbackUrl,
    quality: normalizeQuality(record.quality),
    encodingStatus: normalizeEncodingStatus(record.encodingStatus ?? record.encoding_status),
    uploadedAt: normalizeUploadedAt(record.uploadedAt ?? record.uploaded_at),
  };
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isMediaSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = /** @type {Record<string, unknown>} */ (value);
  const provider = normalizeProvider(source.provider);
  const fileCode = normalizeFileCode(source.fileCode);
  const parsed = typeof source.playbackUrl === "string" ? parseMediaSourceUrl(source.playbackUrl) : null;
  return provider !== null
    && normalizeAssociationId(source.titleId) !== null
    && fileCode !== null
    // Any accepted host of the declared provider is valid. This keeps a
    // Vidmoly link saved as `.org` readable while still rejecting a URL from
    // another provider.
    && parsed !== null
    && parsed.provider === provider
    && parsed.fileCode === fileCode
    && MEDIA_ENCODING_STATUSES.includes(String(source.encodingStatus));
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function playbackUrlForSource(value) {
  return isMediaSource(value) ? /** @type {{ playbackUrl: string }} */ (value).playbackUrl : null;
}

/**
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function sourceList(value) {
  return Array.isArray(value) ? value.filter(isMediaSource) : [];
}

/**
 * @param {unknown} sources
 * @param {string} titleId
 * @returns {Array<Record<string, unknown>>}
 */
export function sourcesForTitle(sources, titleId) {
  const id = normalizeAssociationId(titleId);
  if (!id) return [];
  return sourceList(sources).filter((source) => source.titleId === id);
}

/**
 * @param {unknown} sources
 * @param {string} titleId
 * @param {string} episodeId
 * @returns {Array<Record<string, unknown>>}
 */
export function sourcesForEpisode(sources, titleId, episodeId) {
  const title = normalizeAssociationId(titleId);
  const episode = normalizeAssociationId(episodeId);
  if (!title || !episode) return [];
  return sourceList(sources).filter((source) => source.titleId === title && source.episodeId === episode);
}

/**
 * Returns the best available source for a target: ready sources first, then
 * pending/processing ones. A failed source is never selected.
 *
 * @param {unknown} sources
 * @param {{ titleId: string, episodeId?: string | null }} target
 * @returns {Record<string, unknown> | null}
 */
export function selectPrimarySource(sources, target) {
  const titleId = normalizeAssociationId(target?.titleId);
  if (!titleId) return null;
  const episodeId = normalizeAssociationId(target?.episodeId);
  const candidates = sourceList(sources).filter((source) => source.titleId === titleId
    && (episodeId ? source.episodeId === episodeId : !source.episodeId)
    && source.encodingStatus !== "failed");
  const rank = { ready: 0, processing: 1, pending: 2 };
  return candidates.sort((a, b) => (rank[a.encodingStatus] ?? 3) - (rank[b.encodingStatus] ?? 3))[0] || null;
}
