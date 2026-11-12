/**
 * Legacy library export (LOT 7.5).
 *
 * Builds a portable JSON manifest of the browser-local library and its
 * IndexedDB asset references. The module is pure: the page reads the blobs and
 * triggers the downloads. Nothing here deletes or clears any local data.
 */

export const LEGACY_EXPORT_FORMAT = "cinebox-legacy-export";
export const LEGACY_EXPORT_VERSION = 1;
export const LEGACY_EXPORT_NOTICE = "Export de sauvegarde uniquement : aucune donnée locale, aucun média IndexedDB et aucune fiche D1 n’a été supprimé ou modifié.";

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "text/vtt": "vtt",
};

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {string} value
 * @returns {string}
 */
export function safeFilename(value) {
  const normalized = text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return normalized.slice(0, 120) || "media";
}

/**
 * @param {string} type
 * @returns {string | null}
 */
export function extensionForMime(type) {
  return MIME_EXTENSIONS[text(type).toLocaleLowerCase("en")] || null;
}

/**
 * @param {string} key
 * @returns {string}
 */
function extensionFromKey(key) {
  const match = text(key).match(/\.([A-Za-z0-9]{1,5})$/);
  return match ? match[1].toLocaleLowerCase("en") : "bin";
}

/**
 * Lists every IndexedDB key referenced by a local title, with a human label.
 * Legacy base keys are included exactly like the restore path does.
 *
 * @param {unknown} titles
 * @returns {Array<{
 *   key: string,
 *   titleId: number | null,
 *   titleName: string,
 *   kind: string,
 *   label: string,
 *   episode: { season: number, number: number, title: string } | null,
 * }>}
 */
export function collectLegacyAssetReferences(titles) {
  if (!Array.isArray(titles)) return [];
  const references = [];
  const seen = new Set();
  const add = (key, title, label, episode = null) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    references.push({
      key,
      titleId: Number.isSafeInteger(title.id) ? title.id : null,
      titleName: text(title.name),
      kind: text(title.kind),
      label,
      episode,
    });
  };

  for (const title of titles) {
    if (!isRecord(title)) continue;
    const posterLabel = title.kind === "Vidéo" ? "Miniature vidéo" : "Affiche";
    if (text(title.posterAssetKey)) add(text(title.posterAssetKey), title, posterLabel);
    else if (!text(title.poster) || text(title.poster).startsWith("blob:")) add(`${title.id}:poster`, title, `${posterLabel} (héritée)`);
    if (text(title.backdropAssetKey)) add(text(title.backdropAssetKey), title, "Fond");
    if (text(title.videoAssetKey)) add(text(title.videoAssetKey), title, "Vidéo");
    else if (title.kind !== "Série") add(`${title.id}:video`, title, "Vidéo (héritée)");

    for (const season of Array.isArray(title.seasons) ? title.seasons : []) {
      if (!isRecord(season)) continue;
      if (text(season.posterAssetKey)) add(text(season.posterAssetKey), title, `Affiche de la saison ${season.number}`);
      for (const episode of Array.isArray(season.episodes) ? season.episodes : []) {
        if (!isRecord(episode)) continue;
        const baseKey = `${title.id}:episode:${season.number}:${episode.number}`;
        const episodeInfo = { season: Number(season.number), number: Number(episode.number), title: text(episode.title) };
        add(text(episode.videoAssetKey) || baseKey, title, `Vidéo S${season.number} E${episode.number}`, episodeInfo);
        add(text(episode.thumbnailAssetKey) || `${baseKey}:thumbnail`, title, `Miniature S${season.number} E${episode.number}`, episodeInfo);
      }
    }
  }
  return references;
}

/**
 * Builds the export manifest. Asset entries come from the page after it tried
 * to read each blob (`found`, `missing` or `unreadable`).
 *
 * @param {{
 *   titles: unknown[],
 *   assets?: unknown[],
 *   exportedAt?: string,
 * }} input
 * @returns {Record<string, unknown>}
 */
export function buildLegacyExport(input) {
  const titles = Array.isArray(input?.titles) ? input.titles : [];
  const assets = Array.isArray(input?.assets) ? input.assets : [];
  const exportedAt = text(input?.exportedAt) || new Date().toISOString();
  const found = assets.filter((asset) => isRecord(asset) && asset.status === "found").length;
  const missing = assets.filter((asset) => isRecord(asset) && asset.status === "missing").length;
  const unreadable = assets.filter((asset) => isRecord(asset) && asset.status === "unreadable").length;
  return {
    format: LEGACY_EXPORT_FORMAT,
    version: LEGACY_EXPORT_VERSION,
    exportedAt,
    notice: LEGACY_EXPORT_NOTICE,
    counts: {
      titles: titles.length,
      assets: assets.length,
      found,
      missing,
      unreadable,
    },
    titles,
    assets,
  };
}

/**
 * @param {string} exportedAt
 * @returns {string}
 */
export function legacyExportFilename(exportedAt) {
  const date = new Date(text(exportedAt));
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (value) => String(value).padStart(2, "0");
  return `cinebox-export-local-${valid.getUTCFullYear()}${pad(valid.getUTCMonth() + 1)}${pad(valid.getUTCDate())}-${pad(valid.getUTCHours())}${pad(valid.getUTCMinutes())}${pad(valid.getUTCSeconds())}.json`;
}

/**
 * @param {{ key?: unknown, type?: unknown, label?: unknown }} asset
 * @param {number} index
 * @returns {string}
 */
export function legacyAssetFilename(asset, index = 0) {
  const key = text(asset?.key) || `asset-${index + 1}`;
  const fromMime = extensionForMime(asset?.type);
  const extension = fromMime || extensionFromKey(key);
  const baseKey = fromMime ? key : key.replace(new RegExp(`\\.${extension}$`, "i"), "");
  return `cinebox-media-${String(index + 1).padStart(3, "0")}-${safeFilename(baseKey)}.${extension}`;
}
