import { isContentAllowedForAge } from "../../../lib/cinebox/age-rating.mjs";
import { getAccount, type AccountEnv } from "../../_lib/account-auth.ts";
import { isAdminAccount } from "../../_lib/admin-auth.ts";
import { buildPlaybackUrl, normalizePlaybackUrl } from "../../../lib/cinebox/media-sources.mjs";
import { canAccessContent, catalogListingSql, catalogVisibilitySql, promoTitleForViewer, sanitizeTitleForViewer, vipAccessState } from "../../../lib/cinebox/vip-access.mjs";

interface D1Result<T> { results: T[]; success: boolean; }
interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
}
interface D1Database { prepare(query: string): D1Statement; }
interface CatalogEnv { DB: D1Database; }
interface CatalogEpisodeRow {
  id: string; title_id: string; season_number: number; episode_number: number;
  title: string; overview: string; duration_seconds: number | null;
  thumbnail_path: string | null; metadata_json: string;
}
interface CatalogTitleRow {
  id: string; kind: "movie" | "series" | "video"; title: string; overview: string;
  release_date: string | null; poster_path: string | null; backdrop_path: string | null;
  genres_json: string; metadata_json: string; updated_at: string;
  vip_exclusive: number; vip_early_access: number; public_at: string | null;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    // The response depends on the session cookie: it must never be reused for
    // another viewer. Vary: Cookie is required even with no-store so shared
    // caches cannot serve a VIP payload to a guest.
    "cache-control": "private, no-store, max-age=0",
    "cdn-cache-control": "no-store",
    vary: "Cookie",
    "x-content-type-options": "nosniff",
  }});
}
export async function onRequestGet({ request, env }: { request: Request; env: CatalogEnv }): Promise<Response> {
  if (!env.DB) return json({ error: "Le catalogue distant n'est pas configuré." }, 503);
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (kind && !["movie", "series", "video"].includes(kind)) return json({ error: "Le type de contenu demandé est invalide." }, 400);
  const rawLimit = Number(url.searchParams.get("limit") || 24);
  const rawOffset = Number(url.searchParams.get("offset") || 0);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50 || !Number.isInteger(rawOffset) || rawOffset < 0 || rawOffset > 10000)
    return json({ error: "Les paramètres de pagination sont invalides." }, 400);
  const rawMaxAge = url.searchParams.get("maxAge");
  const maxAge = rawMaxAge === null ? null : Number(rawMaxAge);
  if (maxAge !== null && (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > 18)) return json({ error: "La limite d’âge demandée est invalide." }, 400);

  try {
    // VIP entitlement is derived only from the signed-in server session and the
    // current VIP membership, never from a client query parameter. Community
    // administrators (Fondateur/Admin/Modérateur) are entitled so they can
    // inspect the catalogue they manage.
    const account = await getAccount(request, env as unknown as AccountEnv);
    // One instant per request: membership expiry, the SQL predicate, the
    // reported `access` state and the defence-in-depth sanitiser must agree.
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const vip = account ? await env.DB.prepare("SELECT 1 AS active FROM vip_memberships WHERE user_id=? AND expires_at>? LIMIT 1")
      .bind(account.id, nowIso).first<{ active: number }>() : null;
    const isVip = Boolean(vip);
    const isAdmin = account ? await isAdminAccount(env as unknown as Parameters<typeof isAdminAccount>[0], account.id) : false;
    const entitled = isVip || isAdmin;
    const viewer = { authenticated: Boolean(account), vip: isVip, admin: isAdmin, entitled };
    // Listing and playback are distinct policies: the listing predicate keeps
    // VIP-exclusive rows visible to everyone as a showcase, while the access
    // predicate below decides which rows may carry media URLs.
    const listing = catalogListingSql(entitled, { now: nowIso });
    const whereKind = kind ? " AND kind=?" : "";
    const params = [...listing.params, ...(kind ? [kind] : [])];
    const queryLimit = maxAge === null ? rawLimit : 500;
    const queryOffset = maxAge === null ? rawOffset : 0;
    const result = await env.DB.prepare(
      `SELECT id,kind,title,overview,release_date,poster_path,backdrop_path,genres_json,metadata_json,updated_at,
              vip_exclusive,vip_early_access,public_at
       FROM catalog_titles
       WHERE published=1 AND ${listing.sql}${whereKind}
       ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, queryLimit, queryOffset).all<CatalogTitleRow>();
    if (!result.success) throw new Error("D1 query failed");
    const parsedRows = result.results.map(row => {
      let genres: unknown = []; let metadata: unknown = {};
      try { genres = JSON.parse(row.genres_json); } catch {}
      try { metadata = JSON.parse(row.metadata_json); } catch {}
      return { row, genres: Array.isArray(genres) ? genres : [], metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {} };
    }).filter(entry => maxAge === null || isContentAllowedForAge(entry.metadata, maxAge));
    const pageRows = maxAge === null ? parsedRows : parsedRows.slice(rawOffset, rawOffset + rawLimit);
    // Media (episodes and sources) is only ever loaded for rows the viewer may
    // actually play. A locked showcase row never triggers a media query, so its
    // URL cannot leak even through a future mapping regression.
    const rowFlags = (row: CatalogTitleRow) => ({ vipExclusive: row.vip_exclusive, vipEarlyAccess: row.vip_early_access, publicAt: row.public_at });
    const playableRows = pageRows.filter((entry) => canAccessContent(rowFlags(entry.row), viewer, now));
    const playableIds = playableRows.map((entry) => entry.row.id);
    const episodeResult = playableIds.length ? await env.DB.prepare(
      `SELECT id,title_id,season_number,episode_number,title,overview,duration_seconds,thumbnail_path,metadata_json
       FROM catalog_episodes WHERE title_id IN (${playableIds.map(() => "?").join(",")}) ORDER BY season_number,episode_number`,
    ).bind(...playableIds).all<CatalogEpisodeRow>() : { results: [], success: true };
    if (!episodeResult.success) throw new Error("D1 episode query failed");
    // Playback sources are part of the public catalogue response: without them,
    // an admin can associate a Uqload file but viewers never receive its URL.
    const sourceResult = playableIds.length ? await env.DB.prepare(
      `SELECT title_id,episode_id,provider,file_code,playback_url,encoding_status FROM catalog_media_sources
       WHERE title_id IN (${playableIds.map(() => "?").join(",")})
       ORDER BY CASE LOWER(COALESCE(encoding_status,'')) WHEN 'ready' THEN 0 WHEN 'processing' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
                updated_at DESC, id DESC`,
    ).bind(...playableIds).all<{ title_id: string; episode_id: string | null; provider: string; file_code: string; playback_url: string | null; encoding_status: string | null }>() : { results: [], success: true };
    if (!sourceResult.success) throw new Error("D1 media source query failed");
    const sourceByTitle = new Map<string, string>();
    const sourceByEpisode = new Map<string, string>();
    for (const source of sourceResult.results) {
      // A source explicitly marked as failed must never be served to viewers:
      // the title falls back to Vidsrc or simply shows no embedded player.
      if (String(source.encoding_status || "").trim().toLowerCase() === "failed") continue;
      // Prefer the URL stored in D1, canonicalised at read time. Legacy rows
      // still point to uqload.to/.com/.is/.co; they are rewritten to
      // uqload.vc here, without mutating the database.
      const playbackUrl = normalizePlaybackUrl(source.playback_url) || buildPlaybackUrl(source.file_code, source.provider);
      if (!playbackUrl) continue;
      // The query orders playable sources first, then most recently associated/updated, so adding a new provider switches playback to that source.
      if (source.episode_id) { if (!sourceByEpisode.has(source.episode_id)) sourceByEpisode.set(source.episode_id, playbackUrl); }
      else if (!sourceByTitle.has(source.title_id)) sourceByTitle.set(source.title_id, playbackUrl);
    }
    const episodesByTitle = new Map<string, CatalogEpisodeRow[]>();
    for (const episode of episodeResult.results) {
      const list = episodesByTitle.get(episode.title_id) || []; list.push(episode); episodesByTitle.set(episode.title_id, list);
    }
    const titles = pageRows.map(({ row, genres, metadata }) => {
      const canPlay = canAccessContent(rowFlags(row), viewer, now);
      const base = {
        id: row.id, kind: row.kind, title: row.title, overview: row.overview, releaseDate: row.release_date,
        posterPath: row.poster_path, backdropPath: row.backdrop_path, genres, metadata,
        vipExclusive: Boolean(row.vip_exclusive), vipEarlyAccess: Boolean(row.vip_early_access),
        publicAt: row.public_at ?? null, access: vipAccessState(rowFlags(row), now), updatedAt: row.updated_at,
      };
      // A locked showcase row is published in its promotional shape only: no
      // seasons, no episodes and no media source. The access predicate decided
      // this before any media query was issued.
      if (!canPlay) return promoTitleForViewer({ ...base, vipLocked: true });
      const seasons = new Map<number, { number: number; episodes: Array<Record<string, unknown>> }>();
      for (const episode of episodesByTitle.get(row.id) || []) {
        const season = seasons.get(episode.season_number) || { number: episode.season_number, episodes: [] };
        let episodeMetadata: Record<string, unknown> = {};
        try { const parsed = JSON.parse(episode.metadata_json); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) episodeMetadata = parsed; } catch {}
        season.episodes.push({ number: episode.episode_number, title: episode.title, overview: episode.overview, runtime: episode.duration_seconds, thumbnailPath: episode.thumbnail_path, tmdbId: episodeMetadata.tmdbId ?? null, videoUrl: sourceByEpisode.get(episode.id) });
        seasons.set(episode.season_number, season);
      }
      // The access predicate already vetted this row. This is a second,
      // explicit guard so a future query regression can never leak a video URL.
      return sanitizeTitleForViewer({
        ...base,
        vipLocked: false,
        videoUrl: sourceByTitle.get(row.id),
        seasons: [...seasons.values()],
      }, viewer, now);
    });
    const statsResult = await env.DB.prepare(
      `SELECT COUNT(*) AS titles,
        SUM(CASE WHEN kind='movie' THEN 1 ELSE 0 END) AS films,
        SUM(CASE WHEN kind='series' THEN 1 ELSE 0 END) AS series,
        SUM(CASE WHEN kind='video' THEN 1 ELSE 0 END) AS videos
       FROM catalog_titles WHERE published=1 AND ${listing.sql}`,
    ).bind(...listing.params).all<{ titles:number; films:number; series:number; videos:number }>();
    const episodeVisibility = catalogVisibilitySql(entitled, { now: nowIso, prefix: "t." });
    const episodeStats = await env.DB.prepare(
      `SELECT COUNT(*) AS episodes FROM catalog_episodes e INNER JOIN catalog_titles t ON t.id=e.title_id
       WHERE t.published=1 AND ${episodeVisibility.sql}`,
    ).bind(...episodeVisibility.params).all<{ episodes:number }>();
    const stats = statsResult.results[0] || { titles:0, films:0, series:0, videos:0 };
    return json({ titles, stats: { titles:stats.titles||0, films:stats.films||0, series:stats.series||0, videos:stats.videos||0, episodes:episodeStats.results[0]?.episodes||0 }, pagination:{ limit:rawLimit, offset:rawOffset, count:titles.length }, viewer:{ authenticated:Boolean(account), vip:isVip, admin:isAdmin, entitled } });
  } catch {
    return json({ error: "Impossible de charger le catalogue pour le moment." }, 503);
  }
}
