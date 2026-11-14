import { getAccount, type AccountEnv } from "../../_lib/account-auth.ts";
import { isAdminAccount } from "../../_lib/admin-auth.ts";
import { buildPlaybackUrl, normalizePlaybackUrl } from "../../../lib/cinebox/media-sources.mjs";
import { canAccessContent, sanitizeTitleForViewer, vipAccessState } from "../../../lib/cinebox/vip-access.mjs";

interface D1Result<T> { results: T[]; success: boolean; }
interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
}
interface D1Database { prepare(query: string): D1Statement; }
interface AccessEnv { DB: D1Database; }
interface CatalogTitleRow {
  id: string; kind: "movie" | "series" | "video"; title: string; overview: string;
  release_date: string | null; poster_path: string | null; backdrop_path: string | null;
  genres_json: string; metadata_json: string; updated_at: string;
  vip_exclusive: number; vip_early_access: number; public_at: string | null;
}
interface CatalogEpisodeRow {
  id: string; title_id: string; season_number: number; episode_number: number;
  title: string; overview: string; duration_seconds: number | null;
  thumbnail_path: string | null; metadata_json: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store, max-age=0",
    "cdn-cache-control": "no-store",
    vary: "Cookie",
    "x-content-type-options": "nosniff",
  }});
}

/** Generic answer for both "missing" and "not entitled": never reveal that a VIP title exists. */
const NOT_FOUND = { error: "Ce titre n’est pas disponible." };

/**
 * Revalidate access to one title (used before opening the detail modal or
 * starting playback). The server is the only authority: the client can keep a
 * stale cached copy of a title after a downgrade or a VIP grant/revoke.
 *
 * GET /api/catalog/access?id=<shared-id>
 */
export async function onRequestGet({ request, env }: { request: Request; env: AccessEnv }): Promise<Response> {
  if (!env.DB) return json({ error: "Le catalogue distant n'est pas configuré." }, 503);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id || id.length > 240) return json({ error: "Identifiant de titre invalide." }, 400);

  try {
    const account = await getAccount(request, env as unknown as AccountEnv);
    // The whole request (membership expiry, access decision, reported state,
    // sanitiser) shares one UTC instant so the 48-hour window boundary cannot
    // drift mid-response.
    const now = Date.now();
    const vip = account ? await env.DB.prepare("SELECT 1 AS active FROM vip_memberships WHERE user_id=? AND expires_at>? LIMIT 1")
      .bind(account.id, new Date(now).toISOString()).first<{ active: number }>() : null;
    const isVip = Boolean(vip);
    const isAdmin = account ? await isAdminAccount(env as unknown as Parameters<typeof isAdminAccount>[0], account.id) : false;
    const viewer = { authenticated: Boolean(account), vip: isVip, admin: isAdmin, entitled: isVip || isAdmin };

    const result = await env.DB.prepare(
      `SELECT id,kind,title,overview,release_date,poster_path,backdrop_path,genres_json,metadata_json,updated_at,
              vip_exclusive,vip_early_access,public_at
       FROM catalog_titles WHERE id=? AND published=1 LIMIT 1`,
    ).bind(id).all<CatalogTitleRow>();
    if (!result.success) throw new Error("D1 query failed");
    const row = result.results[0];
    if (!row) return json(NOT_FOUND, 404);
    if (!canAccessContent({ vipExclusive: row.vip_exclusive, vipEarlyAccess: row.vip_early_access, publicAt: row.public_at }, viewer, now)) {
      return json(NOT_FOUND, 404);
    }

    let genres: unknown = [];
    let metadata: unknown = {};
    try { genres = JSON.parse(row.genres_json); } catch {}
    try { metadata = JSON.parse(row.metadata_json); } catch {}

    const episodeResult = await env.DB.prepare(
      `SELECT id,title_id,season_number,episode_number,title,overview,duration_seconds,thumbnail_path,metadata_json
       FROM catalog_episodes WHERE title_id=? ORDER BY season_number,episode_number`,
    ).bind(row.id).all<CatalogEpisodeRow>();
    if (!episodeResult.success) throw new Error("D1 episode query failed");

    const sourceResult = await env.DB.prepare(
      `SELECT title_id,episode_id,provider,file_code,playback_url,encoding_status FROM catalog_media_sources
       WHERE title_id=?
       ORDER BY CASE LOWER(COALESCE(encoding_status,'')) WHEN 'ready' THEN 0 WHEN 'processing' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
                updated_at DESC, id DESC`,
    ).bind(row.id).all<{ title_id: string; episode_id: string | null; provider: string; file_code: string; playback_url: string | null; encoding_status: string | null }>();
    if (!sourceResult.success) throw new Error("D1 media source query failed");

    const sourceByTitle = new Map<string, string>();
    const sourceByEpisode = new Map<string, string>();
    for (const source of sourceResult.results) {
      if (String(source.encoding_status || "").trim().toLowerCase() === "failed") continue;
      const playbackUrl = normalizePlaybackUrl(source.playback_url) || buildPlaybackUrl(source.file_code, source.provider);
      if (!playbackUrl) continue;
      if (source.episode_id) { if (!sourceByEpisode.has(source.episode_id)) sourceByEpisode.set(source.episode_id, playbackUrl); }
      else if (!sourceByTitle.has(source.title_id)) sourceByTitle.set(source.title_id, playbackUrl);
    }

    const seasons = new Map<number, { number: number; episodes: Array<Record<string, unknown>> }>();
    for (const episode of episodeResult.results) {
      const season = seasons.get(episode.season_number) || { number: episode.season_number, episodes: [] };
      let episodeMetadata: Record<string, unknown> = {};
      try { const parsed = JSON.parse(episode.metadata_json); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) episodeMetadata = parsed; } catch {}
      season.episodes.push({
        number: episode.episode_number, title: episode.title, overview: episode.overview,
        runtime: episode.duration_seconds, thumbnailPath: episode.thumbnail_path,
        tmdbId: episodeMetadata.tmdbId ?? null, videoUrl: sourceByEpisode.get(episode.id),
      });
      seasons.set(episode.season_number, season);
    }

    const title = sanitizeTitleForViewer({
      id: row.id, kind: row.kind, title: row.title, overview: row.overview, releaseDate: row.release_date,
      posterPath: row.poster_path, backdropPath: row.backdrop_path,
      genres: Array.isArray(genres) ? genres : [],
      metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
      vipExclusive: Boolean(row.vip_exclusive), vipEarlyAccess: Boolean(row.vip_early_access),
      publicAt: row.public_at ?? null,
      access: vipAccessState({ vipExclusive: row.vip_exclusive, vipEarlyAccess: row.vip_early_access, publicAt: row.public_at }, now),
      videoUrl: sourceByTitle.get(row.id),
      seasons: [...seasons.values()], updatedAt: row.updated_at,
    }, viewer, now);

    return json({ title, viewer });
  } catch {
    return json({ error: "Impossible de vérifier l’accès à ce titre pour le moment." }, 503);
  }
}
