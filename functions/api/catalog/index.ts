import { isContentAllowedForAge } from "../../../lib/cinebox/age-rating.mjs";

interface D1Result<T> {
  results: T[];
  success: boolean;
  meta?: { duration?: number; rows_read?: number };
}

interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  all<T>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface CatalogEnv {
  DB: D1Database;
  BUNNY_STREAM_LIBRARY_ID?: string;
}

interface CatalogEpisodeRow {
  id: string;
  title_id: string;
  season_number: number;
  episode_number: number;
  title: string;
  overview: string;
  duration_seconds: number | null;
  stream_uid: string | null;
  thumbnail_path: string | null;
  metadata_json: string;
}

interface CatalogTitleRow {
  id: string;
  kind: "movie" | "series" | "video";
  title: string;
  overview: string;
  release_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genres_json: string;
  metadata_json: string;
  updated_at: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=30, stale-while-revalidate=60" : "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Public, read-only catalogue endpoint.
 * Writes and personal data remain unavailable until server-side Discord auth exists.
 */
export async function onRequestGet({
  request,
  env,
}: {
  request: Request;
  env: CatalogEnv;
}): Promise<Response> {
  if (!env.DB) return json({ error: "Le catalogue distant n'est pas configuré." }, 503);

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (kind && !["movie", "series", "video"].includes(kind)) {
    return json({ error: "Le type de contenu demandé est invalide." }, 400);
  }

  const rawLimit = Number(url.searchParams.get("limit") || 24);
  const rawOffset = Number(url.searchParams.get("offset") || 0);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50 ||
      !Number.isInteger(rawOffset) || rawOffset < 0 || rawOffset > 10000) {
    return json({ error: "Les paramètres de pagination sont invalides." }, 400);
  }

  // Optional child-profile filter. When present, the server only returns
  // titles that carry a real classification at or below `maxAge`. Unclassified
  // content is excluded (fail closed); the browser filters again as defence in
  // depth. A future authenticated identity will let this be enforced without
  // trusting the query string.
  const rawMaxAge = url.searchParams.get("maxAge");
  const maxAge = rawMaxAge === null ? null : Number(rawMaxAge);
  if (maxAge !== null && (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 18)) {
    return json({ error: "La limite d’âge demandée est invalide." }, 400);
  }
  // Age filtering happens in JavaScript because the classification lives in
  // JSON metadata. Fetch a wider window so a filtered page is still complete.
  const queryLimit = maxAge === null ? rawLimit : 500;
  const queryOffset = maxAge === null ? rawOffset : 0;

  try {
    const statement = kind
      ? env.DB.prepare(
          "SELECT id, kind, title, overview, release_date, poster_path, backdrop_path, genres_json, metadata_json, updated_at FROM catalog_titles WHERE published = 1 AND kind = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        ).bind(kind, queryLimit, queryOffset)
      : env.DB.prepare(
          "SELECT id, kind, title, overview, release_date, poster_path, backdrop_path, genres_json, metadata_json, updated_at FROM catalog_titles WHERE published = 1 ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        ).bind(queryLimit, queryOffset);

    const result = await statement.all<CatalogTitleRow>();
    if (!result.success) throw new Error("D1 query failed");

    const parsedRows = result.results.map((row) => {
      let genres: unknown = [];
      let metadata: unknown = {};
      try { genres = JSON.parse(row.genres_json); } catch { /* Keep a safe default. */ }
      try { metadata = JSON.parse(row.metadata_json); } catch { /* Keep a safe default. */ }
      return {
        row,
        genres: Array.isArray(genres) ? genres : [],
        metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {},
      };
    }).filter((entry) => maxAge === null || isContentAllowedForAge(entry.metadata, maxAge));
    const pageRows = maxAge === null ? parsedRows : parsedRows.slice(rawOffset, rawOffset + rawLimit);

    const episodeResult = pageRows.length
      ? await env.DB.prepare(
          `SELECT id, title_id, season_number, episode_number, title, overview, duration_seconds, stream_uid, thumbnail_path, metadata_json
           FROM catalog_episodes WHERE title_id IN (${pageRows.map(() => "?").join(",")})
           ORDER BY season_number, episode_number`,
        ).bind(...pageRows.map(entry => entry.row.id)).all<CatalogEpisodeRow>()
      : { results: [], success: true };
    if (!episodeResult.success) throw new Error("D1 episode query failed");
    const episodesByTitle = new Map<string, CatalogEpisodeRow[]>();
    for (const episode of episodeResult.results) {
      const list = episodesByTitle.get(episode.title_id) || [];
      list.push(episode);
      episodesByTitle.set(episode.title_id, list);
    }

    const titles = pageRows.map(({ row, genres, metadata }) => {
      const episodeRows = episodesByTitle.get(row.id) || [];
      const seasons = new Map<number, { number: number; episodes: Array<Record<string, unknown>> }>();
      for (const episode of episodeRows) {
        const season = seasons.get(episode.season_number) || { number: episode.season_number, episodes: [] };
        let episodeMetadata: Record<string, unknown> = {};
        try { const parsed = JSON.parse(episode.metadata_json); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) episodeMetadata = parsed; } catch { /* safe default */ }
        season.episodes.push({
          number: episode.episode_number,
          title: episode.title,
          overview: episode.overview,
          runtime: episode.duration_seconds,
          thumbnailPath: episode.thumbnail_path,
          tmdbId: episodeMetadata.tmdbId ?? null,
          videoUrl: episode.stream_uid && env.BUNNY_STREAM_LIBRARY_ID
            ? `https://iframe.mediadelivery.net/embed/${env.BUNNY_STREAM_LIBRARY_ID}/${episode.stream_uid}`
            : null,
        });
        seasons.set(episode.season_number, season);
      }
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        overview: row.overview,
        releaseDate: row.release_date,
        posterPath: row.poster_path,
        backdropPath: row.backdrop_path,
        genres,
        metadata: { ...metadata, ...(env.BUNNY_STREAM_LIBRARY_ID ? { bunnyLibraryId: env.BUNNY_STREAM_LIBRARY_ID } : {}) },
        seasons: [...seasons.values()],
        updatedAt: row.updated_at,
      };
    });

    const statsResult = await env.DB.prepare("SELECT COUNT(*) AS titles, SUM(CASE WHEN kind = 'movie' THEN 1 ELSE 0 END) AS films, SUM(CASE WHEN kind = 'series' THEN 1 ELSE 0 END) AS series, SUM(CASE WHEN kind = 'video' THEN 1 ELSE 0 END) AS videos FROM catalog_titles WHERE published = 1").all<{ titles:number; films:number; series:number; videos:number }>();
    const episodeStats = await env.DB.prepare("SELECT COUNT(*) AS episodes FROM catalog_episodes e INNER JOIN catalog_titles t ON t.id=e.title_id WHERE t.published=1").all<{ episodes:number }>();
    const stats = statsResult.results[0] || {titles:0,films:0,series:0,videos:0};
    return json({ titles, stats: { titles: stats.titles || 0, films: stats.films || 0, series: stats.series || 0, videos: stats.videos || 0, episodes: episodeStats.results[0]?.episodes || 0 }, pagination: { limit: rawLimit, offset: rawOffset, count: titles.length } });
  } catch {
    return json({ error: "Impossible de charger le catalogue pour le moment." }, 503);
  }
}
