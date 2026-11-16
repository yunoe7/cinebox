import { json, getAccount, validOrigin, enforceRateLimit, type AccountEnv } from "../../_lib/account-auth.ts";

const MAX_LIBRARY_BYTES = 2 * 1024 * 1024;
const MAX_TITLES = 300;
const MAX_FAVORITES = 500;
const MAX_HISTORY = 200;
const MAX_PLAYBACK_ITEMS = 500;
const MAX_VIEW_COUNTS = 500;
const MAX_SEASONS_PER_TITLE = 100;
const MAX_EPISODES_PER_SEASON = 500;
const MAX_OBJECT_DEPTH = 12;
const MAX_OBJECT_NODES = 30_000;
const MAX_STRING_LENGTH = 100_000;

type LibraryDocument = {
  version: 1;
  titles: unknown[];
  favorites: number[];
  playback: Record<string, unknown>;
  history: Array<{ titleId: number; viewedAt: number }>;
  viewCounts: Record<string, number>;
  preferences: { autoplayNext: boolean };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const isNonnegativeFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isBoundedString = (value: unknown, max = 10_000) =>
  typeof value === "string" && value.length <= max;

function isBoundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): boolean {
  budget.nodes += 1;
  if (budget.nodes > MAX_OBJECT_NODES || depth > MAX_OBJECT_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= MAX_STRING_LENGTH;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= MAX_TITLES * MAX_EPISODES_PER_SEASON &&
    value.every((item) => isBoundedJson(item, depth + 1, budget));
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 5000 && entries.every(([key, item]) =>
    key.length <= 200 && key !== "__proto__" && key !== "constructor" &&
    isBoundedJson(item, depth + 1, budget));
}

function validEpisode(value: unknown): boolean {
  if (!isRecord(value) || !Number.isSafeInteger(value.number) || Number(value.number) < 0 ||
      !isBoundedString(value.title, 500)) return false;
  for (const key of ["currentTime", "progress", "runtime"] as const) {
    if (value[key] !== undefined && !isNonnegativeFinite(value[key])) return false;
  }
  if (value.progress !== undefined && Number(value.progress) > 100) return false;
  if (value.tmdbId !== undefined && !Number.isSafeInteger(value.tmdbId)) return false;
  return true;
}

function validSeason(value: unknown): boolean {
  if (!isRecord(value) || !Number.isSafeInteger(value.number) || Number(value.number) < 0 ||
      !Array.isArray(value.episodes) || value.episodes.length > MAX_EPISODES_PER_SEASON ||
      !value.episodes.every(validEpisode)) return false;
  if (value.name !== undefined && !isBoundedString(value.name, 500)) return false;
  if (value.overview !== undefined && !isBoundedString(value.overview)) return false;
  return true;
}

function validTitle(value: unknown): boolean {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || Number(value.id) <= 0 ||
      !isBoundedString(value.name, 500) || !value.name.trim() ||
      !["Film", "Série", "Vidéo"].includes(String(value.kind)) ||
      !Number.isSafeInteger(value.year) || Number(value.year) < 1800 || Number(value.year) > 3000 ||
      !isBoundedString(value.genre, 500) || !isBoundedString(value.description) ||
      !isBoundedString(value.poster, 4_000) || !isBoundedString(value.backdrop, 4_000) ||
      !isBoundedString(value.duration, 200) ||
      !isNonnegativeFinite(value.progress) || Number(value.progress) > 100) return false;
  if (value.seasons !== undefined && (!Array.isArray(value.seasons) ||
      value.seasons.length > MAX_SEASONS_PER_TITLE || !value.seasons.every(validSeason))) return false;
  return true;
}

function validPlayback(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length > MAX_PLAYBACK_ITEMS) return false;
  return Object.entries(value).every(([titleId, entry]) => {
    if (!/^\\d{1,16}$/.test(titleId) || !isRecord(entry)) return false;
    for (const key of ["currentTime", "progress"] as const) {
      if (entry[key] !== undefined && !isNonnegativeFinite(entry[key])) return false;
    }
    if (entry.progress !== undefined && Number(entry.progress) > 100) return false;
    if (entry.episodes !== undefined) {
      if (!isRecord(entry.episodes) || Object.keys(entry.episodes).length > MAX_EPISODES_PER_SEASON * MAX_SEASONS_PER_TITLE) return false;
      for (const [episodeId, episode] of Object.entries(entry.episodes)) {
        if (!/^\\d{1,5}:\\d{1,5}$/.test(episodeId) || !isRecord(episode)) return false;
        for (const key of ["currentTime", "progress"] as const) {
          if (episode[key] !== undefined && !isNonnegativeFinite(episode[key])) return false;
        }
        if (episode.progress !== undefined && Number(episode.progress) > 100) return false;
      }
    }
    return true;
  });
}

export function validLibrary(value: unknown): value is LibraryDocument {
  if (!isRecord(value) || value.version !== 1 ||
      !Array.isArray(value.titles) || value.titles.length > MAX_TITLES || !value.titles.every(validTitle) ||
      !Array.isArray(value.favorites) || value.favorites.length > MAX_FAVORITES ||
      !value.favorites.every((id) => Number.isSafeInteger(id) && Number(id) > 0) ||
      !validPlayback(value.playback) ||
      !Array.isArray(value.history) || value.history.length > MAX_HISTORY ||
      !value.history.every((entry) => isRecord(entry) && Number.isSafeInteger(entry.titleId) &&
        Number(entry.titleId) > 0 && isNonnegativeFinite(entry.viewedAt)) ||
      !isRecord(value.viewCounts) || Object.keys(value.viewCounts).length > MAX_VIEW_COUNTS ||
      !Object.entries(value.viewCounts).every(([id, count]) =>
        /^\\d{1,16}$/.test(id) && Number.isSafeInteger(count) && Number(count) >= 0) ||
      !isRecord(value.preferences) || typeof value.preferences.autoplayNext !== "boolean") return false;
  return isBoundedJson(value);
}

async function readLimitedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_LIBRARY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return ""; }
}

export async function onRequestGet({ request, env }: { request: Request; env: AccountEnv }) {
  try {
    const user = await getAccount(request, env);
    if (!user) return json({ error: "unauthorized" }, 401);
    if (!await enforceRateLimit(env, request, "account-library-read:" + user.id, 120, 60))
      return json({ error: "rate-limited" }, 429, { "retry-after": "60" });
    const row = await env.DB.prepare("SELECT library_json, revision, updated_at FROM account_libraries WHERE user_id=? LIMIT 1")
      .bind(user.id).first<{library_json:string;revision:number;updated_at:string}>();
    if (!row) return json({ library: null, revision: 0, updatedAt: null });
    const library = JSON.parse(row.library_json);
    if (!validLibrary(library)) return json({ error: "library-corrupt" }, 500);
    return json({ library, revision: row.revision, updatedAt: row.updated_at });
  } catch {
    return json({ error: "library-unavailable" }, 503);
  }
}

export async function onRequestPut({ request, env }: { request: Request; env: AccountEnv }) {
  if (!validOrigin(request)) return json({ error: "forbidden" }, 403);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_LIBRARY_BYTES) return json({ error: "library-too-large" }, 413);
  try {
    const user = await getAccount(request, env);
    if (!user) return json({ error: "unauthorized" }, 401);
    if (!await enforceRateLimit(env, request, "account-library-write:" + user.id, 30, 60))
      return json({ error: "rate-limited" }, 429, { "retry-after": "60" });
    const raw = await readLimitedBody(request);
    if (raw === null) return json({ error: "library-too-large" }, 413);
    let body: { library?: unknown; revision?: unknown };
    try { body = JSON.parse(raw) as { library?: unknown; revision?: unknown }; }
    catch { return json({ error: "invalid-library" }, 400); }
    if (!isRecord(body) || !validLibrary(body.library) ||
        !Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
      return json({ error: "invalid-library" }, 400);
    const serialized = JSON.stringify(body.library);
    const update = await env.DB.prepare(
      "UPDATE account_libraries SET library_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND revision=?",
    ).bind(serialized, user.id, body.revision).run() as { meta?: { changes?: number } };

    if (update.meta?.changes === 1) return json({ saved: true, revision: Number(body.revision) + 1 });

    if (body.revision === 0) {
      const insert = await env.DB.prepare(
        "INSERT OR IGNORE INTO account_libraries (user_id,library_json,revision,updated_at) VALUES (?,?,1,CURRENT_TIMESTAMP)",
      ).bind(user.id, serialized).run() as { meta?: { changes?: number } };
      if (insert.meta?.changes === 1) return json({ saved: true, revision: 1 });
    }

    const current = await env.DB.prepare("SELECT library_json, revision FROM account_libraries WHERE user_id=?").bind(user.id).first<{library_json:string;revision:number}>();
    let library = null;
    if (current?.library_json) { try { library = JSON.parse(current.library_json); } catch {} }
    return json({ error: "revision-conflict", revision: current?.revision ?? 0, library }, 409);
  } catch {
    return json({ error: "library-save-failed" }, 503);
  }
}
