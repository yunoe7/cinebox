import { resolvePublishId } from "../../../lib/cinebox/shared-id.mjs";
import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";

interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement;
  run(): Promise<{ success: boolean }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean }>>;
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
  bunnyVideoId?: string;
  targetEpisode?: { seasonNumber: number; episodeNumber: number };
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
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const bunnyVideoId = typeof body.bunnyVideoId === "string" && /^[a-f0-9-]{20,64}$/i.test(body.bunnyVideoId) ? body.bunnyVideoId : null;
  if (body.bunnyVideoId && !bunnyVideoId) return json({ error: "Identifiant Bunny invalide." }, 400);
  const targetEpisode = body.targetEpisode && Number.isInteger(body.targetEpisode.seasonNumber) && Number.isInteger(body.targetEpisode.episodeNumber) && body.targetEpisode.seasonNumber >= 0 && body.targetEpisode.episodeNumber >= 1 ? body.targetEpisode : null;
  if (targetEpisode && (!bunnyVideoId || body.kind !== "series")) return json({ error: "Association d’épisode invalide." }, 400);
  if (body.kind === "series" && bunnyVideoId && !targetEpisode) return json({ error: "Choisis un épisode pour associer cette vidéo." }, 400);
  const seasons = body.kind === "series" && Array.isArray(body.seasons) ? body.seasons.slice(0, 100) : [];
  if (targetEpisode && !seasons.some(season =>
    isRecord(season) && season.number === targetEpisode!.seasonNumber && Array.isArray(season.episodes) &&
    season.episodes.some(episode => isRecord(episode) && episode.number === targetEpisode!.episodeNumber)
  )) {
    return json({ error: "L’épisode ciblé est absent de la publication." }, 400);
  }
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO catalog_titles (id, kind, title, overview, release_date, poster_path, backdrop_path, genres_json, metadata_json, published, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, overview=excluded.overview,
       release_date=excluded.release_date, poster_path=excluded.poster_path, backdrop_path=excluded.backdrop_path,
       genres_json=excluded.genres_json,
       metadata_json=json_patch(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END, excluded.metadata_json),
       published=1, updated_at=CURRENT_TIMESTAMP`,
    ).bind(id, body.kind, body.title.trim().slice(0, 300), cleanText(body.overview, 12000),
      cleanText(body.releaseDate, 20) || null, safePath(body.posterPath), safePath(body.backdropPath),
      JSON.stringify(genres), JSON.stringify({ ...metadata, ...(tmdbId ? { tmdbId } : {}), ...(bunnyVideoId && !targetEpisode ? { bunnyVideoId } : {}) })),
  ];

  const episodeIds: string[] = [];
  for (const season of seasons) {
    if (!isRecord(season) || !Number.isInteger(season.number) || season.number < 0 || season.number > 500) continue;
    const episodes = Array.isArray(season.episodes) ? season.episodes.slice(0, 1000) : [];
    for (const episode of episodes) {
      if (!isRecord(episode) || !Number.isInteger(episode.number) || episode.number < 1 || episode.number > 10000) continue;
      const episodeId = `${id}:s${season.number}:e${episode.number}`;
      episodeIds.push(episodeId);
      statements.push(env.DB.prepare(
        `INSERT INTO catalog_episodes (id, title_id, season_number, episode_number, title, overview, duration_seconds, thumbnail_path, metadata_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, overview=excluded.overview, duration_seconds=excluded.duration_seconds,
         thumbnail_path=excluded.thumbnail_path, metadata_json=excluded.metadata_json, updated_at=CURRENT_TIMESTAMP`,
      ).bind(episodeId, id, season.number, episode.number, cleanText(episode.title, 300) || `Épisode ${episode.number}`,
        cleanText(episode.overview, 8000), Number.isInteger(episode.runtime) ? Math.max(0, Math.min(86400, episode.runtime as number)) : null,
        safePath(episode.thumbnailPath), JSON.stringify({ tmdbId: episode.tmdbId ?? null, airDate: cleanText(episode.airDate, 20) })));
    }
  }

  if (targetEpisode && bunnyVideoId) {
    const episodeId = `${id}:s${targetEpisode.seasonNumber}:e${targetEpisode.episodeNumber}`;
    statements.push(env.DB.prepare("UPDATE catalog_episodes SET stream_uid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND title_id = ?").bind(bunnyVideoId, episodeId, id));
  }

  try {
    const results = await env.DB.batch(statements);
    if (results.some(result => !result.success)) throw new Error("D1 batch failed");
    return json({ published: true, id, kind: body.kind, episodesPublished: episodeIds.length });
  } catch {
    return json({ error: "La publication dans le catalogue partagé a échoué." }, 503);
  }
}
