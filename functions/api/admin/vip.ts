import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";

interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<{ success: boolean }>;
}
interface DB { prepare(sql: string): Statement; }
interface Env extends AdminEnv {
  DB?: DB;
}

async function authorize(request: Request, env: Env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: "Base de données indisponible." }, 503);
  return null;
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  try {
    const search = (new URL(request.url).searchParams.get("search") || "").trim().replace(/[%_]/g, "").slice(0, 80);
    if (search.length >= 2) {
      const pattern = `%${search}%`;
      const result = await env.DB!.prepare(
        "SELECT u.id AS userId, u.display_name AS displayName, i.provider_username AS discordUsername, i.provider_global_name AS discordName, v.expires_at AS expiresAt FROM users u LEFT JOIN auth_identities i ON i.user_id=u.id AND i.provider='discord' LEFT JOIN vip_memberships v ON v.user_id=u.id WHERE u.display_name LIKE ? OR i.provider_username LIKE ? OR i.provider_global_name LIKE ? ORDER BY u.display_name COLLATE NOCASE LIMIT 25",
      ).bind(pattern, pattern, pattern).all<{ userId:string; displayName:string; discordUsername:string|null; discordName:string|null; expiresAt:string|null }>();
      if (!result.success) throw new Error("search-failed");
      const now = Date.now();
      return json({ users: result.results.map(item => ({ ...item, active: Boolean(item.expiresAt && Date.parse(item.expiresAt) > now) })) });
    }
    const result = await env.DB!.prepare(
      "SELECT v.user_id AS userId, u.display_name AS displayName, v.expires_at AS expiresAt, v.granted_by AS grantedBy, v.created_at AS createdAt FROM vip_memberships v JOIN users u ON u.id=v.user_id ORDER BY v.expires_at DESC LIMIT 500",
    ).all<{ userId:string; displayName:string; expiresAt:string; grantedBy:string|null; createdAt:string }>();
    if (!result.success) throw new Error("query-failed");
    const now = Date.now();
    return json({ memberships: result.results.map(item => ({ ...item, active: Date.parse(item.expiresAt) > now })) });
  } catch {
    return json({ error: "Impossible de charger les membres VIP." }, 503);
  }
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  let body: { userId?: unknown; expiresAt?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ error: "JSON invalide." }, 400); }
  if (typeof body.userId !== "string" || !body.userId.trim() || body.userId.length > 128) {
    return json({ error: "Identifiant de compte invalide." }, 400);
  }
  if (typeof body.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\.?(?:\d{3})?Z$/.test(body.expiresAt) || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now()) {
    return json({ error: "La date d’expiration doit être une date ISO future." }, 400);
  }
  try {
    const user = await env.DB!.prepare("SELECT id FROM users WHERE id=? LIMIT 1").bind(body.userId).all<{ id: string }>();
    if (!user.success || !user.results.length) return json({ error: "Compte CinéBox introuvable." }, 404);
    await env.DB!.prepare(
      "INSERT INTO vip_memberships (user_id, expires_at, granted_by) VALUES (?, ?, 'admin') ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at, granted_by=excluded.granted_by, updated_at=CURRENT_TIMESTAMP",
    ).bind(body.userId, new Date(body.expiresAt).toISOString()).run();
    return json({ updated: true, userId: body.userId, expiresAt: new Date(body.expiresAt).toISOString() });
  } catch {
    return json({ error: "Impossible d’activer le statut VIP." }, 503);
  }
}

export async function onRequestDelete({ request, env }: { request: Request; env: Env }) {
  const denied = await authorize(request, env);
  if (denied) return denied;
  let body: { userId?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ error: "JSON invalide." }, 400); }
  if (typeof body.userId !== "string" || !body.userId.trim() || body.userId.length > 128) {
    return json({ error: "Identifiant de compte invalide." }, 400);
  }
  try {
    await env.DB!.prepare("DELETE FROM vip_memberships WHERE user_id=?").bind(body.userId).run();
    return json({ revoked: true, userId: body.userId, discord });
  } catch {
    return json({ error: "Impossible de retirer le statut VIP." }, 503);
  }
}
