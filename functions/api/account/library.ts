import { json, getAccount, validOrigin, enforceRateLimit, type AccountEnv } from "../../_lib/account-auth.ts";

const MAX_LIBRARY_BYTES = 2 * 1024 * 1024;
const MAX_TITLES = 300;
const MAX_FAVORITES = 500;
const MAX_HISTORY = 200;
const MAX_PLAYBACK_ITEMS = 500;
const MAX_VIEW_COUNTS = 500;

type LibraryDocument = {
  version: 1;
  titles: unknown[];
  favorites: number[];
  playback: Record<string, unknown>;
  history: Array<{ titleId: number; viewedAt: number }>;
  viewCounts: Record<string, number>;
  preferences: { autoplayNext: boolean };
};

function validLibrary(value: unknown): value is LibraryDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.titles) || v.titles.length > MAX_TITLES ||
      !Array.isArray(v.favorites) || v.favorites.length > MAX_FAVORITES ||
      !v.favorites.every((id) => Number.isSafeInteger(id)) ||
      !v.playback || typeof v.playback !== "object" || Array.isArray(v.playback) || Object.keys(v.playback).length > MAX_PLAYBACK_ITEMS ||
      !Array.isArray(v.history) || v.history.length > MAX_HISTORY || !v.history.every((entry) => !!entry && typeof entry === "object" &&
        Number.isSafeInteger((entry as {titleId?: unknown}).titleId) &&
        typeof (entry as {viewedAt?: unknown}).viewedAt === "number" && Number.isFinite((entry as {viewedAt:number}).viewedAt)) ||
      !v.viewCounts || typeof v.viewCounts !== "object" || Array.isArray(v.viewCounts) || Object.keys(v.viewCounts).length > MAX_VIEW_COUNTS ||
      !v.preferences || typeof v.preferences !== "object" ||
      typeof (v.preferences as {autoplayNext?: unknown}).autoplayNext !== "boolean") return false;
  return true;
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
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_LIBRARY_BYTES) return json({ error: "library-too-large" }, 413);
    const body = JSON.parse(raw) as { library?: unknown; revision?: unknown };
    if (!validLibrary(body.library) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
      return json({ error: "invalid-library" }, 400);
    const serialized = JSON.stringify(body.library);
    const result = await env.DB.prepare(
      "INSERT INTO account_libraries (user_id,library_json,revision,updated_at) SELECT ?,?,1,CURRENT_TIMESTAMP WHERE ?=0 ON CONFLICT(user_id) DO UPDATE SET library_json=excluded.library_json,revision=account_libraries.revision+1,updated_at=CURRENT_TIMESTAMP WHERE account_libraries.revision=?",
    ).bind(user.id, serialized, body.revision, body.revision).run() as { meta?: { changes?: number } };
    if (result.meta?.changes === 0) {
      const current = await env.DB.prepare("SELECT library_json, revision FROM account_libraries WHERE user_id=?").bind(user.id).first<{library_json:string;revision:number}>();
      let library = null;
      if (current?.library_json) { try { library = JSON.parse(current.library_json); } catch {} }
      return json({ error: "revision-conflict", revision: current?.revision ?? 0, library }, 409);
    }
    const current = await env.DB.prepare("SELECT revision FROM account_libraries WHERE user_id=?").bind(user.id).first<{revision:number}>();
    return json({ saved: true, revision: current?.revision ?? 1 });
  } catch {
    return json({ error: "library-save-failed" }, 503);
  }
}
