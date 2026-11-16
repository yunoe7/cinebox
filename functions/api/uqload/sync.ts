import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";
import { buildPlaybackUrl, encodingStatusFromCanplay } from "../../../lib/cinebox/media-sources.mjs";

interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  all<T>(): Promise<{ success: boolean; results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}
interface DB { prepare(sql: string): Statement; }
interface Env extends AdminEnv {
  DB?: DB;
  UQLOAD_API_KEY?: string;
  TMDB_READ_ACCESS_TOKEN?: string;
}
type Obj = Record<string, unknown>;
const UQLOAD_API = "https://uqload.vc/api";
const TMDB_API = "https://api.themoviedb.org/3";
const MAX_FILES_PER_SYNC = 100;
const MAX_SYNC_PAGES = 20;
// Reconciliation is destructive by nature: never remove more than this many
// rows in one run without a human confirming the remote account state.
const MAX_SYNC_DELETIONS = 100;

function isObj(v: unknown): v is Obj { return !!v && typeof v === "object" && !Array.isArray(v); }
function clean(v: unknown, max = 300): string { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function normalize(v: string): string {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\b(vostfr|vf|vff| vost|french|multi|1080p|720p|480p|bluray|brrip|webrip|web-dl|h264|h265|x264|x265)\b/gi, " ")
    .replace(/[._-]+/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function similarity(a: string, b: string): number {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) / Math.max(x.length, y.length);
  const xs = new Set(x.split(" ")), ys = new Set(y.split(" "));
  const intersection = [...xs].filter(w => ys.has(w)).length;
  return (2 * intersection) / (xs.size + ys.size);
}
function parseFilename(raw: string): { kind: "movie" | "series"; title: string; year?: string; season?: number; episode?: number } | null {
  const name = raw.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/\[[^\]]*\]/g, " ");
  // Uqload filenames sometimes contain OCR-like O/I characters in SxxEyy markers.
  const ep = name.match(/^(.*?)\s*[._ -]+S([0-9OQIl]{1,2})\s*[._ -]*E([0-9OQIl]{1,3})(?=$|[^0-9])/i)
    || name.match(/^(.*?)\b([0-9OQIl]{1,2})x([0-9OQIl]{1,3})(?=$|[^0-9])/i);
  if (ep && clean(ep[1])) {
    const digits = (value: string) => value.replace(/[OQ]/gi, "0").replace(/[Il]/g, "1");
    const season = Number(digits(ep[2])), episode = Number(digits(ep[3]));
    if (Number.isInteger(season) && Number.isInteger(episode) && season >= 0 && episode > 0)
      return { kind: "series", title: clean(ep[1]).replace(/[._-]+/g, " "), season, episode };
  }
  const year = name.match(/\b(19\d{2}|20\d{2})\b/);
  const title = clean(year ? name.slice(0, year.index) : name)
    .replace(/\bS[0-9OQIl]{1,2}[._ -]*E[0-9OQIl]{1,3}\b.*$/i, " ")
    .replace(/[._-]+/g, " ");
  if (!title || normalize(title).length < 2) return null;
  return { kind: "movie", title, ...(year ? { year: year[1] } : {}) };
}
async function getJson(url: URL, headers: HeadersInit = {}): Promise<Obj> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isObj(body)) throw new Error("Service externe temporairement indisponible.");
  return body;
}
async function uqload(path: string, key: string, params: Record<string, string> = {}): Promise<Obj> {
  const url = new URL(UQLOAD_API + path); url.searchParams.set("key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const body = await getJson(url);
  if (Number(body.status) !== 200) throw new Error("Uqload a refusé la synchronisation.");
  return body;
}
async function tmdb(path: string, token: string, params: Record<string, string> = {}): Promise<Obj> {
  const url = new URL(TMDB_API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const isV3 = /^[a-f\d]{32}$/i.test(token);
  if (isV3) url.searchParams.set("api_key", token);
  return getJson(url, { ...(isV3 ? {} : { Authorization: "Bearer " + token }), Accept: "application/json" });
}
function rows(payload: Obj): Obj[] {
  if (Array.isArray(payload.result)) return payload.result.filter(isObj);
  if (isObj(payload.result)) for (const k of ["files", "results", "list"]) if (Array.isArray(payload.result[k])) return (payload.result[k] as unknown[]).filter(isObj);
  return [];
}
async function createDraftAndAssociate(db: DB, file: Obj, uqKey: string, tmdbToken: string): Promise<{status:"created"|"skipped"|"existing";reason?:string}> {
  const fileCode = clean(file.file_code || file.code, 64);
  const filename = clean(file.file_title || file.title || file.name, 300);
  if (!/^[A-Za-z0-9]{6,64}$/.test(fileCode) || !filename) return {status:"skipped",reason:"Le fichier Uqload ne contient pas de code ou de nom exploitable."};
  const already = await db.prepare("SELECT id FROM catalog_media_sources WHERE provider='uqload' AND file_code=?").bind(fileCode).all<{id:string}>();
  const encodingStatus = encodingStatusFromCanplay(file.canplay);
  const quality = clean(file.file_quality ?? file.quality, 40) || null;
  const uploadedAt = clean(file.uploaded || file.uploaded_at || file.created, 40) || null;
  if (already.results?.length) {
    // The file is already associated: refresh its real state instead of
    // returning early, otherwise a file stuck in "processing" would never
    // become playable after Uqload finishes encoding it.
    await db.prepare("UPDATE catalog_media_sources SET encoding_status=?, quality=COALESCE(?, quality), uploaded_at=COALESCE(?, uploaded_at), updated_at=CURRENT_TIMESTAMP WHERE provider='uqload' AND file_code=?")
      .bind(encodingStatus, quality, uploadedAt, fileCode).run();
    return {status:"existing"};
  }
  const parsed = parseFilename(filename);
  if (!parsed) return {status:"skipped",reason:`Nom non reconnu : ${filename}`};

  const searchPath = parsed.kind === "series" ? "/search/tv" : "/search/movie";
  const search = await tmdb(searchPath, tmdbToken, { query: parsed.title, include_adult: "false", language: "fr-FR", page: "1", ...(parsed.year ? { year: parsed.year } : {}) });
  const candidates = Array.isArray(search.results) ? search.results.filter(isObj) : [];
  const ranked = candidates.map(candidate => ({
    candidate,
    score: Math.max(similarity(parsed.title, clean(candidate.title || candidate.name)), similarity(parsed.title, clean(candidate.original_title || candidate.original_name))),
  })).sort((a,b) => b.score-a.score);
  const best = ranked[0];
  // Never guess between unrelated titles. A confident match is required for automatic creation.
  if (!best || best.score < 0.82 || (ranked[1] && best.score - ranked[1].score < 0.08)) return {status:"skipped",reason:`Correspondance TMDB insuffisante pour « ${parsed.title} » (meilleur score : ${best ? best.score.toFixed(2) : "aucun résultat"}).`};
  const tmdbId = Number(best.candidate.id);
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return {status:"skipped",reason:"TMDB a renvoyé un identifiant invalide."};

  const kind = parsed.kind;
  const id = `tmdb:${kind}:${tmdbId}`;
  const detailPath = kind === "series" ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
  const detail = await tmdb(detailPath, tmdbToken, { language: "fr-FR" });
  const title = clean(detail.title || detail.name, 300);
  if (!title) return {status:"skipped",reason:"TMDB n’a pas fourni de titre."};
  const genres = Array.isArray(detail.genres) ? detail.genres.filter(isObj).map(g => clean(g.name, 80)).filter(Boolean) : [];
  const releaseDate = clean(detail.release_date || detail.first_air_date, 20) || null;
  const poster = clean(detail.poster_path, 180) || null;
  const backdrop = clean(detail.backdrop_path, 180) || null;
  const overview = clean(detail.overview, 12000);
  const metadata = JSON.stringify({ tmdbId, originalTitle: clean(detail.original_title || detail.original_name), autoImported: true });
  await db.prepare(`INSERT INTO catalog_titles (id,kind,title,overview,release_date,poster_path,backdrop_path,genres_json,metadata_json,published,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,overview=excluded.overview,release_date=excluded.release_date,
    poster_path=COALESCE(catalog_titles.poster_path,excluded.poster_path),backdrop_path=COALESCE(catalog_titles.backdrop_path,excluded.backdrop_path),
    genres_json=excluded.genres_json,metadata_json=json_patch(CASE WHEN json_valid(catalog_titles.metadata_json) THEN catalog_titles.metadata_json ELSE '{}' END,excluded.metadata_json),updated_at=CURRENT_TIMESTAMP`)
    .bind(id, kind, title, overview, releaseDate, poster, backdrop, JSON.stringify(genres), metadata).run();

  let episodeId: string | null = null;
  if (kind === "series" && parsed.season !== undefined && parsed.episode !== undefined) {
    const season = await tmdb(`/tv/${tmdbId}/season/${parsed.season}`, tmdbToken, { language: "fr-FR" }).catch(() => ({} as Obj));
    const episodes = Array.isArray(season.episodes) ? season.episodes.filter(isObj) : [];
    const remoteEpisode = episodes.find(e => Number(e.episode_number) === parsed.episode);
    episodeId = `${id}:s${parsed.season}:e${parsed.episode}`;
    await db.prepare(`INSERT INTO catalog_episodes (id,title_id,season_number,episode_number,title,overview,duration_seconds,thumbnail_path,metadata_json,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,overview=excluded.overview,duration_seconds=excluded.duration_seconds,thumbnail_path=excluded.thumbnail_path,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP`)
      .bind(episodeId, id, parsed.season, parsed.episode, clean(remoteEpisode?.name) || `Épisode ${parsed.episode}`,
        clean(remoteEpisode?.overview, 8000), Number.isFinite(Number(remoteEpisode?.runtime)) ? Number(remoteEpisode?.runtime) * 60 : null,
        clean(remoteEpisode?.still_path, 180) || null, JSON.stringify({ tmdbId: remoteEpisode?.id ?? null, airDate: clean(remoteEpisode?.air_date, 20) })).run();
  }
  const playbackUrl = buildPlaybackUrl(fileCode, "uqload");
  await db.prepare(`INSERT INTO catalog_media_sources (id,title_id,episode_id,provider,file_code,video_id,playback_url,quality,encoding_status,uploaded_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(provider,file_code) DO NOTHING`)
    .bind(crypto.randomUUID(), id, episodeId, "uqload", fileCode, fileCode, playbackUrl, quality, encodingStatus,
      uploadedAt).run();
  return {status:"created"};
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const db = env.DB;
  const uqloadApiKey = env.UQLOAD_API_KEY;
  const tmdbReadAccessToken = env.TMDB_READ_ACCESS_TOKEN;
  const missing: string[] = [];
  if (!db) missing.push("DB (liaison D1)");
  if (!uqloadApiKey) missing.push("UQLOAD_API_KEY");
  if (!tmdbReadAccessToken) missing.push("TMDB_READ_ACCESS_TOKEN");
  if (missing.length) {
    return json({ error: "Configuration serveur incomplète.", missing }, 503);
  }
  if (!db || !uqloadApiKey || !tmdbReadAccessToken) {
    return json({ error: "Configuration serveur incomplète." }, 503);
  }
  const files: Obj[] = [];
  let page = 1;
  let inventoryComplete = false;
  let inventoryIssue: string | null = null;
  let expectedPages: number | null = null;
  let expectedTotal: number | null = null;
  let observedFiles = 0;
  while (page <= MAX_SYNC_PAGES) {
    const payload = await uqload("/file/list", uqloadApiKey, { per_page: String(MAX_FILES_PER_SYNC), page: String(page) });
    const result = isObj(payload.result) ? payload.result : null;
    const reportedPages = Number(result?.pages);
    const reportedTotal = Number(result?.results_total);
    const hasPageCount = Number.isSafeInteger(reportedPages) && reportedPages >= 1;
    const hasTotal = Number.isSafeInteger(reportedTotal) && reportedTotal >= 0;
    if (page === 1) {
      if (hasPageCount) expectedPages = reportedPages;
      if (hasTotal) expectedTotal = reportedTotal;
      if (!hasPageCount || !hasTotal) inventoryIssue = "Pagination Uqload incomplète : métadonnées pages/results_total absentes.";
      if (hasPageCount && reportedPages > MAX_SYNC_PAGES) inventoryIssue = `Inventaire Uqload trop volumineux : ${reportedPages} pages dépassent le plafond de ${MAX_SYNC_PAGES}.`;
    } else if ((hasPageCount && expectedPages !== reportedPages) || (hasTotal && expectedTotal !== reportedTotal) || !hasPageCount || !hasTotal) {
      inventoryIssue = "Les métadonnées de pagination Uqload ont changé pendant la synchronisation.";
    }
    const batch = rows(payload).slice(0, MAX_FILES_PER_SYNC);
    files.push(...batch);
    observedFiles += batch.length;

    if (expectedPages !== null && page >= expectedPages) {
      inventoryComplete = inventoryIssue === null;
      break;
    }
    if (batch.length === 0) {
      inventoryIssue ||= "Une page Uqload est vide avant la fin annoncée de l’inventaire.";
      break;
    }
    if (page === MAX_SYNC_PAGES) {
      inventoryIssue ||= "Plafond de pagination atteint : inventaire Uqload incomplet.";
      break;
    }
    // Without trustworthy page metadata, continue only while the page is full.
    // A short page ends discovery, but never authorizes destructive reconciliation.
    if (expectedPages === null && batch.length < MAX_FILES_PER_SYNC) break;
    page++;
  }
  if (inventoryComplete && expectedTotal !== observedFiles) {
    inventoryComplete = false;
    inventoryIssue = `Inventaire incohérent : ${observedFiles} fichiers reçus sur ${expectedTotal} annoncés.`;
  }
  const hasInvalidRemoteCode = files.some(file => !/^[A-Za-z0-9]{6,64}$/.test(clean(file.file_code || file.code, 64)));
  if (inventoryComplete && hasInvalidRemoteCode) {
    inventoryComplete = false;
    inventoryIssue = "Inventaire distant contenant des fichiers sans code exploitable : aucune suppression effectuée.";
  }
  let deleted = 0;
  let deletionSkipped: string | null = inventoryIssue;
  // Reconcile only after reading the complete remote inventory. An empty or
  // suspicious inventory is never trusted: an account/key mismatch or an API
  // change must not wipe the catalogue's media sources.
  const liveCodes = new Set(files.map(file => clean(file.file_code || file.code, 64)).filter(code => /^[A-Za-z0-9]{6,64}$/.test(code)));
  if (!inventoryComplete) {
    deletionSkipped ||= "Inventaire distant incomplet : aucune suppression effectuée.";
  } else if (files.length === 0) {
    deletionSkipped = "Inventaire distant vide : aucune suppression effectuée.";
  } else if (liveCodes.size === 0) {
    deletionSkipped = "Inventaire distant sans fichier exploitable : aucune suppression effectuée.";
  } else {
    const stored = await db.prepare("SELECT file_code FROM catalog_media_sources WHERE provider='uqload'").all<{file_code:string}>();
    const stale = (stored.results || []).filter(source => !liveCodes.has(source.file_code));
    if (stale.length > MAX_SYNC_DELETIONS) {
      deletionSkipped = `${stale.length} sources absentes du compte dépassent le plafond de ${MAX_SYNC_DELETIONS} : vérifie le compte Uqload avant de relancer.`;
    } else {
      for (const source of stale) {
        const result = await db.prepare("DELETE FROM catalog_media_sources WHERE provider='uqload' AND file_code=?").bind(source.file_code).run();
        deleted += Number(result.meta?.changes || 0);
      }
    }
  }
  let created = 0, existing = 0, skipped = 0;
  const details: Array<{file:string;status:string;reason?:string}> = [];
  for (const file of files) {
    const filename = clean(file.file_title || file.title || file.name, 300) || "Fichier sans nom";
    try {
      const result = await createDraftAndAssociate(db, file, uqloadApiKey, tmdbReadAccessToken);
      if (result.status === "created") created++;
      else if (result.status === "existing") existing++;
      else { skipped++; details.push({file:filename,status:"ignoré",reason:result.reason}); }
    } catch (error) {
      skipped++;
      details.push({file:filename,status:"erreur",reason:error instanceof Error ? error.message : "Erreur inconnue"});
    }
  }
  return json({ synced: true, scanned: files.length, created, existing, skipped, deleted, inventoryComplete, deletionSkipped, details, publishedAutomatically: false });
}
