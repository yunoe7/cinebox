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

  try {
    const statement = kind
      ? env.DB.prepare(
          "SELECT id, kind, title, overview, release_date, poster_path, backdrop_path, genres_json, metadata_json, updated_at FROM catalog_titles WHERE published = 1 AND kind = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        ).bind(kind, rawLimit, rawOffset)
      : env.DB.prepare(
          "SELECT id, kind, title, overview, release_date, poster_path, backdrop_path, genres_json, metadata_json, updated_at FROM catalog_titles WHERE published = 1 ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        ).bind(rawLimit, rawOffset);

    const result = await statement.all<CatalogTitleRow>();
    if (!result.success) throw new Error("D1 query failed");

    const titles = result.results.map((row) => {
      let genres: unknown = [];
      let metadata: unknown = {};
      try { genres = JSON.parse(row.genres_json); } catch { /* Keep a safe default. */ }
      try { metadata = JSON.parse(row.metadata_json); } catch { /* Keep a safe default. */ }
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        overview: row.overview,
        releaseDate: row.release_date,
        posterPath: row.poster_path,
        backdropPath: row.backdrop_path,
        genres: Array.isArray(genres) ? genres : [],
        metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
        updatedAt: row.updated_at,
      };
    });

    return json({ titles, pagination: { limit: rawLimit, offset: rawOffset, count: titles.length } });
  } catch {
    return json({ error: "Impossible de charger le catalogue pour le moment." }, 503);
  }
}
