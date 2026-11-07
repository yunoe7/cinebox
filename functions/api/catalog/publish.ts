interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement;
  run(): Promise<{ success: boolean }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<Array<{ success: boolean }>>;
}
interface PublishEnv {
  DB?: D1Database;
  CINEBOX_ADMIN_TOKEN?: string;
}
type PublishBody = {
  tmdbId: number;
  kind: "movie" | "series";
  title: string;
  overview?: string;
  releaseDate?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  genres?: string[];
  metadata?: Record<string, unknown>;
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
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

/** Publishes a TMDB-backed title to the shared catalogue. Requires a server-only admin secret. */
export async function onRequestPost({ request, env }: { request: Request; env: PublishEnv }): Promise<Response> {
  const expected = env.CINEBOX_ADMIN_TOKEN;
  if (!expected || expected.length < 32) {
    return json({ error: "La publication partagée est désactivée : le secret administrateur n'est pas configuré." }, 503);
  }
  const supplied = request.headers.get("authorization") || "";
  const token = supplied.startsWith("Bearer ") ? supplied.slice(7) : "";
  if (!token || token.length !== expected.length) return json({ error: "Authentification administrateur requise." }, 401);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  if (mismatch !== 0) return json({ error: "Authentification administrateur requise." }, 401);
  if (!env.DB) return json({ error: "Le catalogue distant n'est pas configuré." }, 503);

  let body: PublishBody;
  try {
    const raw: unknown = await request.json();
    if (!isRecord(raw)) return json({ error: "Corps de requête invalide." }, 400);
    body = raw as unknown as PublishBody;
  } catch {
    return json({ error: "Corps JSON invalide." }, 400);
  }

  if (!Number.isSafeInteger(body.tmdbId) || body.tmdbId <= 0 ||
      !["movie", "series"].includes(body.kind) ||
      typeof body.title !== "string" || !body.title.trim() || body.title.length > 300) {
    return json({ error: "Les informations du titre sont invalides." }, 400);
  }
  const genres = Array.isArray(body.genres)
    ? body.genres.filter((item): item is string => typeof item === "string").slice(0, 30).map(item => item.slice(0, 80))
    : [];
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const seasons = body.kind === "series" && Array.isArray(body.seasons) ? body.seasons.slice(0, 100) : [];
  const id = `tmdb:${body.kind}:${body.tmdbId}`;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO catalog_titles (id, kind, title, overview, release_date, poster_path, backdrop_path, genres_json, metadata_json, published, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, overview=excluded.overview,
       release_date=excluded.release_date, poster_path=excluded.poster_path, backdrop_path=excluded.backdrop_path,
       genres_json=excluded.genres_json, metadata_json=excluded.metadata_json, published=1, updated_at=CURRENT_TIMESTAMP`,
    ).bind(id, body.kind, body.title.trim().slice(0, 300), cleanText(body.overview, 12000),
      cleanText(body.releaseDate, 20) || null, safePath(body.posterPath), safePath(body.backdropPath),
      JSON.stringify(genres), JSON.stringify({ ...metadata, tmdbId: body.tmdbId })),
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

  try {
    const results = await env.DB.batch(statements);
    if (results.some(result => !result.success)) throw new Error("D1 batch failed");
    return json({ published: true, id, kind: body.kind, episodesPublished: episodeIds.length });
  } catch {
    return json({ error: "La publication dans le catalogue partagé a échoué." }, 503);
  }
}
