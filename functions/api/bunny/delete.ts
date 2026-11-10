import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";

interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean }>;
}
interface DB {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Array<{ success: boolean }>>;
}
interface Env extends AdminEnv {
  DB?: DB;
  BUNNY_STREAM_API_KEY?: string;
  BUNNY_STREAM_LIBRARY_ID?: string;
}
interface TitleRow {
  id: string;
  metadata_json: string;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  return {};
}
function referencesVideo(row: TitleRow, videoId: string): boolean {
  return parseMetadata(row.metadata_json).bunnyVideoId === videoId;
}
async function findReferencingTitles(db: DB, videoId: string): Promise<TitleRow[]> {
  const rows = await db
    .prepare("SELECT id, metadata_json FROM catalog_titles WHERE metadata_json LIKE ?")
    .bind(`%${videoId}%`)
    .all<TitleRow>();
  if (!rows.success) throw new Error("titles");
  return rows.results.filter((row) => referencesVideo(row, videoId));
}
async function videoStillReferenced(db: DB, videoId: string): Promise<boolean> {
  const episodes = await db
    .prepare("SELECT id FROM catalog_episodes WHERE stream_uid=? LIMIT 1")
    .bind(videoId)
    .all<{ id: string }>();
  if (!episodes.success) throw new Error("episodes");
  if (episodes.results.length > 0) return true;
  const titles = await findReferencingTitles(db, videoId);
  return titles.length > 0;
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB || !env.BUNNY_STREAM_API_KEY || !env.BUNNY_STREAM_LIBRARY_ID) {
    return json({ error: "Configuration Bunny ou D1 manquante." }, 503);
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide." }, 400);
  }
  const id = typeof body?.videoId === "string" ? body.videoId : "";
  if (!/^[a-f0-9-]{20,64}$/i.test(id)) return json({ error: "Identifiant Bunny invalide." }, 400);

  // 1. Detach every D1 reference before touching Bunny. The batch is transactional:
  //    either all references are removed, or none are and Bunny is left untouched.
  let titles: TitleRow[];
  try {
    titles = await findReferencingTitles(env.DB, id);
  } catch {
    return json({ error: "Impossible de vérifier les références D1. Aucune vidéo n'a été supprimée." }, 503);
  }

  const statements: Statement[] = [
    env.DB.prepare("UPDATE catalog_episodes SET stream_uid=NULL, updated_at=CURRENT_TIMESTAMP WHERE stream_uid=?").bind(id),
  ];
  for (const title of titles) {
    const metadata = parseMetadata(title.metadata_json);
    delete metadata.bunnyVideoId;
    statements.push(
      env.DB.prepare("UPDATE catalog_titles SET metadata_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND metadata_json=?")
        .bind(JSON.stringify(metadata), title.id, title.metadata_json),
    );
  }

  try {
    const results = await env.DB.batch(statements);
    if (results.some((result) => !result.success)) throw new Error("detach");
  } catch {
    return json({ error: "Le détachement D1 a échoué. Aucune vidéo n'a été supprimée." }, 503);
  }

  // 2. A concurrent edit may have re-added the reference after our snapshot.
  //    Never delete a video that D1 still points to.
  try {
    if (await videoStillReferenced(env.DB, id)) {
      return json({
        error: "Une fiche référence encore cette vidéo (modification concurrente). La vidéo n'a pas été supprimée.",
        conflict: true,
        bunnyDeleted: false,
        retryable: true,
      }, 409);
    }
  } catch {
    return json({
      error: "Le détachement D1 a réussi, mais la vérification a échoué. La vidéo n'a pas été supprimée : relance la suppression.",
      detached: true,
      bunnyDeleted: false,
      retryable: true,
    }, 503);
  }

  // 3. D1 is clean: delete the Bunny file. A 404 means it was already gone.
  let upstream: Response;
  try {
    upstream = await fetch(`https://video.bunnycdn.com/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${id}`, {
      method: "DELETE",
      headers: { AccessKey: env.BUNNY_STREAM_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return json({
      error: "L'association D1 a été retirée, mais Bunny n'a pas répondu. La vidéo peut encore exister : relance la suppression.",
      detached: true,
      bunnyDeleted: false,
      retryable: true,
    }, 502);
  }

  if (!upstream.ok && upstream.status !== 404) {
    return json({
      error: upstream.status === 401 || upstream.status === 403
        ? "L'association D1 a été retirée, mais Bunny a refusé la suppression. Vérifie les droits de la clé API, puis relance."
        : "L'association D1 a été retirée, mais Bunny n'a pas confirmé la suppression. La vidéo peut encore exister : relance la suppression.",
      detached: true,
      bunnyDeleted: false,
      retryable: true,
    }, 502);
  }

  return json({ deleted: true, videoId: id, detached: true, bunnyDeleted: true, alreadyAbsent: upstream.status === 404 });
}
