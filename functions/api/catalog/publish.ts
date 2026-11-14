import { resolvePublishId } from "../../../lib/cinebox/shared-id.mjs";
import { normalizeCatalogMetadata } from "../../../lib/cinebox/catalog-metadata.mjs";
import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";
import { validateVipSettings } from "../../../lib/cinebox/vip-access.mjs";

/**
 * Bounds for a single publish request.
 *
 * D1 allows 100 bound parameters per statement and batches of thousands of
 * statements. Every episode upsert uses ~9 parameters and every obsolete
 * episode is removed with one scoped DELETE, so these caps keep the whole
 * batch well below the D1 limits while remaining far above any realistic
 * CinéBox season/title size.
 */
const MAX_PUBLISH_EPISODES = 500;
const MAX_RECONCILED_DELETIONS = 1000;

interface D1Result {
  success: boolean;
  meta?: { changes?: number };
}
interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  all<T>(): Promise<{ success: boolean; results: T[] }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
interface PublishEnv extends AdminEnv {
  DB?: D1Database;
}
type PublishBody = {
  id?: string;
  tmdbId?: number;
  kind: "movie" | "series" | "video";
  title: string;
  overview?: string;
  releaseDate?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  genres?: string[];
  metadata?: Record<string, unknown>;
  /** Optional VIP rights. Omitted means "keep the stored rights unchanged". */
  vipExclusive?: boolean;
  vipEarlyAccess?: boolean;
  publicAt?: string | null;
  /** Replace the full episode list of the single season present in `seasons`. */
  replaceSeason?: boolean;
  /** Replace the full episode list of the title. Requires a complete snapshot. */
  replaceTitle?: boolean;
  seasons?: Array<{
    number: number;
    name?: string;
    overview?: string;
    airDate?: string;
    tmdbId?: number;
    episodes?: Array<{
      number: number;
      title: string;
      overview?: string;
      airDate?: string;
      runtime?: number;
      tmdbId?: number;
      thumbnailPath?: string | null;
    }>;
  }>;
};

type ParsedEpisode = {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview: string;
  runtime: number | null;
  thumbnailPath: string | null;
  metadataJson: string;
};
type ParsedSeason = { number: number; episodes: ParsedEpisode[] };
type ParsedSeasons =
  | { ok: true; seasons: ParsedSeason[]; episodes: ParsedEpisode[]; totalEpisodes: number }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function safePath(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\/[a-zA-Z0-9_./-]{1,240}$/.test(value) || value.includes("..")) return null;
  return value;
}

/**
 * Parse and validate the season payload.
 *
 * `strict` is used by the replacement modes: every season and episode must be
 * valid and unique, because the payload is treated as a complete snapshot.
 * The legacy upsert mode keeps the historical lenient behaviour and skips
 * malformed entries, but still enforces the global episode cap.
 */
function parseSeasons(rawSeasons: unknown, titleId: string, strict: boolean): ParsedSeasons {
  if (rawSeasons === undefined || rawSeasons === null) {
    return { ok: true, seasons: [], episodes: [], totalEpisodes: 0 };
  }
  if (!Array.isArray(rawSeasons)) {
    return strict
      ? { ok: false, error: "La liste des saisons est invalide." }
      : { ok: true, seasons: [], episodes: [], totalEpisodes: 0 };
  }

  const seasonByNumber = new Map<number, ParsedSeason>();
  const episodeById = new Map<string, ParsedEpisode>();
  const episodes: ParsedEpisode[] = [];

  for (const rawSeason of rawSeasons) {
    if (!isRecord(rawSeason) || !Number.isInteger(rawSeason.number) || (rawSeason.number as number) < 0 || (rawSeason.number as number) > 500) {
      if (strict) return { ok: false, error: "Une saison de la publication est invalide." };
      continue;
    }
    const seasonNumber = rawSeason.number as number;
    let season = seasonByNumber.get(seasonNumber);
    if (!season) {
      season = { number: seasonNumber, episodes: [] };
      seasonByNumber.set(seasonNumber, season);
    } else if (strict) {
      return { ok: false, error: "Une saison est présente plusieurs fois dans la publication." };
    }

    const rawEpisodes = rawSeason.episodes;
    if (!Array.isArray(rawEpisodes)) {
      if (strict) return { ok: false, error: "La liste des épisodes d’une saison est invalide." };
      continue;
    }

    for (const rawEpisode of rawEpisodes) {
      if (!isRecord(rawEpisode) || !Number.isInteger(rawEpisode.number) || (rawEpisode.number as number) < 1 || (rawEpisode.number as number) > 10000) {
        if (strict) return { ok: false, error: "Un épisode de la publication est invalide." };
        continue;
      }
      const episodeNumber = rawEpisode.number as number;
      const episodeId = `${titleId}:s${seasonNumber}:e${episodeNumber}`;
      const parsed: ParsedEpisode = {
        id: episodeId,
        seasonNumber,
        episodeNumber,
        title: cleanText(rawEpisode.title, 300) || `Épisode ${episodeNumber}`,
        overview: cleanText(rawEpisode.overview, 8000),
        runtime: Number.isInteger(rawEpisode.runtime) ? Math.max(0, Math.min(86400, rawEpisode.runtime as number)) : null,
        thumbnailPath: safePath(rawEpisode.thumbnailPath),
        metadataJson: JSON.stringify({ tmdbId: rawEpisode.tmdbId ?? null, airDate: cleanText(rawEpisode.airDate, 20) }),
      };

      const existing = episodeById.get(episodeId);
      if (existing) {
        if (strict) return { ok: false, error: "Un épisode est présent plusieurs fois dans la publication." };
        Object.assign(existing, parsed);
        continue;
      }
      episodeById.set(episodeId, parsed);
      season.episodes.push(parsed);
      episodes.push(parsed);
      if (episodes.length > MAX_PUBLISH_EPISODES) {
        return { ok: false, error: `Une publication ne peut pas dépasser ${MAX_PUBLISH_EPISODES} épisodes.` };
      }
    }
  }

  return { ok: true, seasons: [...seasonByNumber.values()], episodes, totalEpisodes: episodes.length };
}

/**
 * Read the episode ids that currently exist in the replacement scope.
 *
 * The ids are read from D1 so the obsolete set is exact: it is the difference
 * between the stored rows and the validated payload, never a client-provided
 * list. `seasonNumber === null` scopes the read to the whole title.
 */
async function readScopedEpisodeIds(
  db: D1Database,
  titleId: string,
  seasonNumber: number | null,
): Promise<string[]> {
  const sql = seasonNumber === null
    ? "SELECT id FROM catalog_episodes WHERE title_id = ?"
    : "SELECT id FROM catalog_episodes WHERE title_id = ? AND season_number = ?";
  const values = seasonNumber === null ? [titleId] : [titleId, seasonNumber];
  const result = await db.prepare(sql).bind(...values).all<{ id: string }>();
  if (!result.success || !Array.isArray(result.results)) throw new Error("D1 read failed");
  return result.results.map(row => row.id);
}

/**
 * Queue one scoped DELETE per obsolete episode.
 *
 * Each statement targets a single primary-key id and is additionally scoped by
 * `title_id` (and `season_number` for replaceSeason), so a deletion can never
 * escape the validated replacement scope. One statement per id also keeps
 * every query far below D1's 100-bound-parameters limit and avoids the
 * chunked `NOT IN` trap where a later chunk deletes episodes kept earlier.
 */
function addDeleteStatements(
  push: (statement: D1PreparedStatement, isDelete?: boolean) => void,
  db: D1Database,
  titleId: string,
  seasonNumber: number | null,
  obsoleteIds: string[],
): void {
  for (const episodeId of obsoleteIds) {
    const sql = seasonNumber === null
      ? "DELETE FROM catalog_episodes WHERE title_id = ? AND id = ?"
      : "DELETE FROM catalog_episodes WHERE title_id = ? AND season_number = ? AND id = ?";
    const values = seasonNumber === null
      ? [titleId, episodeId]
      : [titleId, seasonNumber, episodeId];
    push(db.prepare(sql).bind(...values), true);
  }
}

/** Publishes a TMDB-backed title to the shared catalogue. Requires a signed admin session. */
export async function onRequestPost({ request, env }: { request: Request; env: PublishEnv }): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: "Le catalogue distant n'est pas configuré." }, 503);

  let body: PublishBody;
  try {
    const raw: unknown = await request.json();
    if (!isRecord(raw)) return json({ error: "Corps de requête invalide." }, 400);
    body = raw as unknown as PublishBody;
  } catch {
    return json({ error: "Corps JSON invalide." }, 400);
  }

  const tmdbId = Number.isSafeInteger(body.tmdbId) && Number(body.tmdbId) > 0 ? Number(body.tmdbId) : null;
  const id = resolvePublishId({ id: body.id, kind: body.kind, tmdbId });
  if (!id || !["movie", "series", "video"].includes(body.kind) ||
      typeof body.title !== "string" || !body.title.trim() || body.title.length > 300) {
    return json({ error: "Les informations du titre sont invalides." }, 400);
  }
  const genres = Array.isArray(body.genres)
    ? body.genres.filter((item): item is string => typeof item === "string").slice(0, 30).map(item => item.slice(0, 80))
    : [];
  const metadata = normalizeCatalogMetadata(isRecord(body.metadata) ? body.metadata : {});

  if (body.replaceSeason !== undefined && typeof body.replaceSeason !== "boolean") {
    return json({ error: "L’indicateur replaceSeason est invalide." }, 400);
  }
  if (body.replaceTitle !== undefined && typeof body.replaceTitle !== "boolean") {
    return json({ error: "L’indicateur replaceTitle est invalide." }, 400);
  }
  const replaceSeason = body.replaceSeason === true;
  const replaceTitle = body.replaceTitle === true;
  if (replaceSeason && replaceTitle) {
    return json({ error: "replaceSeason et replaceTitle ne peuvent pas être combinés." }, 400);
  }

  let parsed: ParsedSeasons;
  if (body.kind !== "series") {
    const hasSeasons = Array.isArray(body.seasons)
      ? body.seasons.length > 0
      : body.seasons !== undefined && body.seasons !== null;
    if ((replaceSeason || replaceTitle) && hasSeasons) {
      return json({ error: "Un film ou une vidéo ne peut pas contenir de saisons." }, 400);
    }
    parsed = { ok: true, seasons: [], episodes: [], totalEpisodes: 0 };
  } else {
    if (replaceSeason && (!Array.isArray(body.seasons) || body.seasons.length !== 1)) {
      return json({ error: "replaceSeason exige exactement une saison complète." }, 400);
    }
    if (replaceTitle && (!Array.isArray(body.seasons) || body.seasons.length === 0)) {
      return json({ error: "replaceTitle exige un instantané complet des saisons." }, 400);
    }
    parsed = parseSeasons(body.seasons, id, replaceSeason || replaceTitle);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    if (replaceSeason && parsed.totalEpisodes === 0) {
      return json({ error: "Une saison complète doit contenir au moins un épisode." }, 400);
    }
    if (replaceTitle && parsed.totalEpisodes === 0) {
      return json({ error: "Un instantané complet de série doit contenir au moins un épisode." }, 400);
    }
  }

  // Read the current kind and VIP rights before writing. A kind change is a
  // destructive operation: it requires an explicit full-title snapshot
  // (replaceTitle). VIP rights are only written when the caller explicitly
  // sends them, so republishing a title never silently resets its audience.
  let existingKind: string | null = null;
  let existingVip: { vip_exclusive: number; vip_early_access: number; public_at: string | null } | null = null;
  try {
    const existing = await env.DB.prepare(
      "SELECT kind, vip_exclusive, vip_early_access, public_at FROM catalog_titles WHERE id = ?",
    ).bind(id).all<{ kind: string; vip_exclusive: number; vip_early_access: number; public_at: string | null }>();
    if (!existing.success) throw new Error("D1 read failed");
    existingKind = existing.results[0]?.kind ?? null;
    existingVip = existing.results[0]
      ? {
          vip_exclusive: Number(existing.results[0].vip_exclusive) || 0,
          vip_early_access: Number(existing.results[0].vip_early_access) || 0,
          public_at: existing.results[0].public_at ?? null,
        }
      : null;
  } catch {
    return json({ error: "Impossible de vérifier l’état du titre dans le catalogue partagé." }, 503);
  }
  if (existingKind !== null && existingKind !== body.kind && !replaceTitle) {
    return json({ error: "Le type de ce titre change. Une publication complète avec replaceTitle est requise." }, 400);
  }

  const hasVipInput = body.vipExclusive !== undefined || body.vipEarlyAccess !== undefined || body.publicAt !== undefined;
  let vip: { vipExclusive: boolean; vipEarlyAccess: boolean; publicAt: string | null } | null = null;
  if (hasVipInput) {
    const validated = validateVipSettings({
      vipExclusive: body.vipExclusive === undefined ? Boolean(existingVip?.vip_exclusive) : body.vipExclusive,
      vipEarlyAccess: body.vipEarlyAccess === undefined ? Boolean(existingVip?.vip_early_access) : body.vipEarlyAccess,
      publicAt: body.publicAt === undefined ? existingVip?.public_at ?? null : body.publicAt,
    });
    if (!validated.ok) return json({ error: validated.error }, 400);
    vip = validated.value;
  }

  // Compute the exact obsolete set before any write. The deletions are derived
  // from the rows stored in D1, not from a client-provided id list, so an
  // obsolete id can only be an episode that exists in the replacement scope.
  const deletionSeason = replaceSeason ? parsed.seasons[0].number : null;
  let obsoleteIds: string[] = [];
  if (replaceSeason || replaceTitle) {
    try {
      const existingIds = await readScopedEpisodeIds(env.DB, id, deletionSeason);
      const keptIds = new Set(parsed.episodes.map(episode => episode.id));
      obsoleteIds = existingIds.filter(existingId => !keptIds.has(existingId));
    } catch {
      return json({ error: "Impossible de lire les épisodes existants du catalogue partagé." }, 503);
    }
    if (obsoleteIds.length > MAX_RECONCILED_DELETIONS) {
      return json({ error: `Une publication ne peut pas supprimer plus de ${MAX_RECONCILED_DELETIONS} épisodes.` }, 400);
    }
  }

  const statements: D1PreparedStatement[] = [];
  const deleteStatementIndexes = new Set<number>();
  const push = (statement: D1PreparedStatement, isDelete = false) => {
    if (isDelete) deleteStatementIndexes.add(statements.length);
    statements.push(statement);
  };

  const baseValues: (string | number | null)[] = [
    id, body.kind, body.title.trim().slice(0, 300), cleanText(body.overview, 12000),
    cleanText(body.releaseDate, 20) || null, safePath(body.posterPath), safePath(body.backdropPath),
    JSON.stringify(genres), JSON.stringify({ ...metadata, ...(tmdbId ? { tmdbId } : {}) }),
  ];
  if (vip) {
    push(env.DB.prepare(
      `INSERT INTO catalog_titles (id, kind, title, overview, release_date, poster_path, backdrop_path, genres_json, metadata_json, published, updated_at, vip_exclusive, vip_early_access, public_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, overview=excluded.overview,
       release_date=excluded.release_date, poster_path=excluded.poster_path, backdrop_path=excluded.backdrop_path,
       genres_json=excluded.genres_json,
       metadata_json=json_patch(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, excluded.metadata_json),
       vip_exclusive=excluded.vip_exclusive, vip_early_access=excluded.vip_early_access, public_at=excluded.public_at,
       published=1, updated_at=CURRENT_TIMESTAMP`,
    ).bind(...baseValues, vip.vipExclusive ? 1 : 0, vip.vipEarlyAccess ? 1 : 0, vip.publicAt));
  } else {
    push(env.DB.prepare(
      `INSERT INTO catalog_titles (id, kind, title, overview, release_date, poster_path, backdrop_path, genres_json, metadata_json, published, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, overview=excluded.overview,
       release_date=excluded.release_date, poster_path=excluded.poster_path, backdrop_path=excluded.backdrop_path,
       genres_json=excluded.genres_json,
       metadata_json=json_patch(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, excluded.metadata_json),
       published=1, updated_at=CURRENT_TIMESTAMP`,
    ).bind(...baseValues));
  }

  for (const episode of parsed.episodes) {
    push(env.DB.prepare(
      `INSERT INTO catalog_episodes (id, title_id, season_number, episode_number, title, overview, duration_seconds, thumbnail_path, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, overview=excluded.overview, duration_seconds=excluded.duration_seconds,
       thumbnail_path=excluded.thumbnail_path, metadata_json=excluded.metadata_json, updated_at=CURRENT_TIMESTAMP`,
    ).bind(episode.id, id, episode.seasonNumber, episode.episodeNumber, episode.title,
      episode.overview, episode.runtime, episode.thumbnailPath, episode.metadataJson));
  }

  if (replaceSeason || replaceTitle) {
    addDeleteStatements(push, env.DB, id, deletionSeason, obsoleteIds);
  }

  try {
    const results = await env.DB.batch(statements);
    if (results.length !== statements.length || results.some(result => !result.success)) throw new Error("D1 batch failed");
    let episodesDeleted = 0;
    for (const index of deleteStatementIndexes) {
      episodesDeleted += Number(results[index]?.meta?.changes ?? 0);
    }
    return json({
      published: true,
      id,
      kind: body.kind,
      mode: replaceTitle ? "replaceTitle" : replaceSeason ? "replaceSeason" : "upsert",
      episodesPublished: parsed.episodes.length,
      episodesDeleted,
    });
  } catch {
    return json({ error: "La publication dans le catalogue partagé a échoué." }, 503);
  }
}
