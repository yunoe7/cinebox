import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";
import { validateVipSettings, vipAccessState } from "../../../lib/cinebox/vip-access.mjs";

interface Statement { bind(...values: (string | number | null)[]): Statement; all<T>(): Promise<{ results: T[]; success: boolean }>; run(): Promise<{ success: boolean }>; }
interface DB { prepare(sql: string): Statement; }
interface Env extends AdminEnv { DB?: DB; }
interface TitleRow { id: string; kind: "movie" | "series" | "video"; title: string; overview: string; release_date: string | null; poster_path: string | null; backdrop_path: string | null; genres_json: string; metadata_json: string; published: number; updated_at: string; vip_exclusive: number; vip_early_access: number; public_at: string | null; }
interface EpisodeRow { id: string; title_id: string; season_number: number; episode_number: number; title: string; overview: string; duration_seconds: number | null; thumbnail_path: string | null; metadata_json: string; }

const TITLE_COLUMNS = "id,kind,title,overview,release_date,poster_path,backdrop_path,genres_json,metadata_json,published,updated_at,vip_exclusive,vip_early_access,public_at";

function parseGenres(value: string): unknown[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseMetadata(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }

/** Read the authoritative row before validating or writing anything. */
async function readTitle(db: DB, id: string): Promise<TitleRow | null> {
  const result = await db.prepare(`SELECT ${TITLE_COLUMNS} FROM catalog_titles WHERE id=? LIMIT 1`).bind(id).all<TitleRow>();
  if (!result.success) throw new Error("read");
  return result.results[0] ?? null;
}

/** Shape returned to the administration UI. It mirrors the stored row, never the request. */
function adminTitle(row: TitleRow) {
  return {
    id: row.id, kind: row.kind, title: row.title, overview: row.overview, release_date: row.release_date,
    poster_path: row.poster_path, backdrop_path: row.backdrop_path, genres: parseGenres(row.genres_json),
    metadata: parseMetadata(row.metadata_json), published: row.published, updated_at: row.updated_at,
    vip_exclusive: row.vip_exclusive, vip_early_access: row.vip_early_access, public_at: row.public_at,
    access: vipAccessState({ vipExclusive: row.vip_exclusive, vipEarlyAccess: row.vip_early_access, publicAt: row.public_at }),
  };
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  if (!env.DB) return json({ error: "Base de données indisponible." }, 503);
  try {
    const titles = await env.DB.prepare(`SELECT ${TITLE_COLUMNS} FROM catalog_titles ORDER BY updated_at DESC`).all<TitleRow>();
    if (!titles.success) throw new Error("titles");
    const episodes = await env.DB.prepare("SELECT id,title_id,season_number,episode_number,title,overview,duration_seconds,thumbnail_path,metadata_json FROM catalog_episodes ORDER BY title_id,season_number,episode_number").all<EpisodeRow>();
    if (!episodes.success) throw new Error("episodes");
    const items = titles.results.map(t => ({
      ...adminTitle(t),
      episodes: episodes.results.filter(e => e.title_id === t.id).map(e => ({ ...e, metadata: parseMetadata(e.metadata_json) })),
    }));
    return json({ titles: items });
  } catch { return json({ error: "Impossible de charger les titres administrés." }, 503); }
}

export async function onRequestPatch({ request, env }: { request: Request; env: Env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  if (!env.DB) return json({ error: "Base de données indisponible." }, 503);
  let body: any; try { body = await request.json(); } catch { return json({ error: "JSON invalide." }, 400); }
  if (typeof body?.id !== "string" || !body.id.trim()) return json({ error: "Identifiant manquant." }, 400);
  const id = body.id.trim();
  const hasVipInput = body.vip_exclusive !== undefined || body.vip_early_access !== undefined || body.public_at !== undefined
    || body.vipExclusive !== undefined || body.vipEarlyAccess !== undefined || body.publicAt !== undefined;
  const hasPublished = typeof body.published === "boolean";
  const hasEditable = body.title !== undefined || body.overview !== undefined || body.release_date !== undefined
    || body.poster_path !== undefined || body.backdrop_path !== undefined || hasVipInput || hasPublished;
  if (!hasEditable) return json({ error: "Aucune modification fournie." }, 400);

  try {
    const current = await readTitle(env.DB, id);
    if (!current) return json({ error: "Titre introuvable." }, 404);

    // Editing ordinary metadata must never touch the rights. VIP columns are
    // written only when the caller explicitly sends the VIP settings.
    let vipExclusive = Boolean(current.vip_exclusive);
    let vipEarlyAccess = Boolean(current.vip_early_access);
    let publicAt = current.public_at;
    if (hasVipInput) {
      const requestedExclusive = body.vip_exclusive !== undefined ? body.vip_exclusive : body.vipExclusive;
      const requestedEarly = body.vip_early_access !== undefined ? body.vip_early_access : body.vipEarlyAccess;
      const requestedPublicAt = body.public_at !== undefined ? body.public_at : body.publicAt;
      // Missing booleans keep the stored value; the caller must therefore state
      // the full mode when it changes one flag, which prevents silent downgrades.
      const validated = validateVipSettings({
        vipExclusive: requestedExclusive === undefined ? Boolean(current.vip_exclusive) : requestedExclusive,
        vipEarlyAccess: requestedEarly === undefined ? Boolean(current.vip_early_access) : requestedEarly,
        publicAt: requestedPublicAt === undefined ? current.public_at : requestedPublicAt,
      });
      if (!validated.ok) return json({ error: validated.error }, 400);
      vipExclusive = validated.value.vipExclusive;
      vipEarlyAccess = validated.value.vipEarlyAccess;
      publicAt = validated.value.publicAt;
    }

    const title = body.title !== undefined ? (typeof body.title === "string" ? body.title.trim().slice(0, 300) : current.title) : current.title;
    if (body.title !== undefined && !title) return json({ error: "Le titre ne peut pas être vide." }, 400);
    const overview = body.overview !== undefined ? (typeof body.overview === "string" ? body.overview.slice(0, 12000) : current.overview) : current.overview;
    const releaseDate = body.release_date !== undefined ? (typeof body.release_date === "string" ? body.release_date.slice(0, 20) : current.release_date) : current.release_date;
    const posterPath = body.poster_path === null ? null
      : typeof body.poster_path === "string" && /^\/[a-zA-Z0-9_./-]{1,240}$/.test(body.poster_path) && !body.poster_path.includes("..") ? body.poster_path
      : body.poster_path === undefined ? current.poster_path
      : null;
    const backdropPath = body.backdrop_path === null ? null
      : typeof body.backdrop_path === "string" && /^\/[a-zA-Z0-9_./-]{1,240}$/.test(body.backdrop_path) && !body.backdrop_path.includes("..") ? body.backdrop_path
      : body.backdrop_path === undefined ? current.backdrop_path
      : null;
    const published = hasPublished ? (body.published ? 1 : 0) : current.published;

    await env.DB.prepare(
      "UPDATE catalog_titles SET title=?,overview=?,release_date=?,poster_path=?,backdrop_path=?,published=?,vip_exclusive=?,vip_early_access=?,public_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(title, overview, releaseDate, posterPath, backdropPath, published, vipExclusive ? 1 : 0, vipEarlyAccess ? 1 : 0, publicAt, id).run();

    // Always answer with the stored values, not with an echo of the request.
    const updated = await readTitle(env.DB, id);
    if (!updated) return json({ error: "Le titre n’a pas pu être relu après la modification." }, 503);
    return json({ updated: true, id, title: adminTitle(updated) });
  } catch { return json({ error: "Modification impossible." }, 503); }
}

export async function onRequestDelete({ request, env }: { request: Request; env: Env }) {
  const denied = await requireAdmin(request, env); if (denied) return denied;
  if (!env.DB) return json({ error: "Base de données indisponible." }, 503);
  let body: any; try { body = await request.json(); } catch { return json({ error: "JSON invalide." }, 400); }
  if (typeof body?.id !== "string" || !body.id.trim()) return json({ error: "Identifiant manquant." }, 400);
  const id = body.id.trim();
  try {
    const exists = await env.DB.prepare("SELECT id FROM catalog_titles WHERE id=?").bind(id).all<{ id: string }>();
    if (!exists.success) return json({ error: "Impossible de vérifier le titre dans D1." }, 503);
    if (!exists.results.length) return json({ deleted: true, id, alreadyDeleted: true });
    if (body.permanent === true) {
      // Delete every dependent record explicitly, then verify the parent row is gone.
      const cleanup = [
        ["catalog_media_sources", "DELETE FROM catalog_media_sources WHERE title_id=?"],
        ["media_assets", "DELETE FROM media_assets WHERE title_id=? OR episode_id IN (SELECT id FROM catalog_episodes WHERE title_id=?)"],
        ["user_favorites", "DELETE FROM user_favorites WHERE title_id=?"],
        ["user_progress", "DELETE FROM user_progress WHERE title_id=?"],
        ["watch_history", "DELETE FROM watch_history WHERE title_id=?"],
        ["catalog_episodes", "DELETE FROM catalog_episodes WHERE title_id=?"]
      ] as const;
      for (const [table, sql] of cleanup) {
        const statement = table === "media_assets"
          ? env.DB.prepare(sql).bind(id, id)
          : env.DB.prepare(sql).bind(id);
        const result = await statement.run();
        if (!result.success) return json({ error: "Suppression interrompue pendant le nettoyage de " + table + "." }, 503);
      }
      const deleted = await env.DB.prepare("DELETE FROM catalog_titles WHERE id=?").bind(id).run();
      if (!deleted.success) return json({ error: "D1 a refusé la suppression de la fiche." }, 503);
      const remaining = await env.DB.prepare("SELECT id FROM catalog_titles WHERE id=?").bind(id).all<{ id: string }>();
      if (!remaining.success || remaining.results.length) return json({ error: "La fiche existe encore dans D1 après la suppression. Vérifie les contraintes de la base." }, 503);
      return json({ deleted: true, id, verified: true });
    }
    const result = await env.DB.prepare("UPDATE catalog_titles SET published=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
    if (!result.success) return json({ error: "Retrait du catalogue impossible." }, 503);
    return json({ unpublished: true, id });
  } catch { return json({ error: "Erreur D1 pendant la suppression. Aucune confirmation de réussite n'a été envoyée." }, 503); }
}
