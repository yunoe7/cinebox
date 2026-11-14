import { json, requireAdmin, type AdminEnv } from "../../_lib/admin-auth.ts";
import { parsePublicAt } from "../../../lib/cinebox/vip-access.mjs";

interface Statement { bind(...values: (string | number | null)[]): Statement; all<T>(): Promise<{ results: T[]; success: boolean }>; }
interface DB { prepare(sql: string): Statement; }
interface Env extends AdminEnv { DB?: DB; }

type Row = {
  id: string;
  title: string;
  published: number;
  vip_exclusive: number;
  vip_early_access: number;
  public_at: string | null;
};

type Issue = {
  id: string;
  title: string;
  code: "exclusive-and-early" | "early-without-date" | "early-invalid-date" | "exclusive-with-date" | "hidden-vip";
  message: string;
};

/**
 * Read-only consistency report for the VIP columns.
 *
 * This endpoint never mutates data. It exists so operators can inspect
 * production D1 inconsistencies before choosing a migration/fix, as required
 * by the VIP access-control rollout. It requires an administrator session.
 *
 * GET /api/admin/vip-audit
 */
export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: "Base de données indisponible." }, 503);
  try {
    const result = await env.DB.prepare(
      "SELECT id,title,published,vip_exclusive,vip_early_access,public_at FROM catalog_titles ORDER BY updated_at DESC",
    ).all<Row>();
    if (!result.success) throw new Error("D1 read failed");

    const issues: Issue[] = [];
    for (const row of result.results) {
      const exclusive = Number(row.vip_exclusive) === 1;
      const early = Number(row.vip_early_access) === 1;
      const hasDate = typeof row.public_at === "string" && row.public_at.trim() !== "";
      if (exclusive && early) {
        issues.push({ id: row.id, title: row.title, code: "exclusive-and-early", message: "Exclusif VIP et avant-première simultanément." });
      }
      if (early && !hasDate) {
        issues.push({ id: row.id, title: row.title, code: "early-without-date", message: "Avant-première sans date publique : le titre reste VIP uniquement." });
      }
      if (early && hasDate && parsePublicAt(row.public_at) === null) {
        issues.push({ id: row.id, title: row.title, code: "early-invalid-date", message: "Date publique illisible : le titre reste VIP uniquement." });
      }
      if (exclusive && hasDate) {
        issues.push({ id: row.id, title: row.title, code: "exclusive-with-date", message: "Titre exclusif avec une date publique inutile." });
      }
      if (Number(row.published) !== 1 && (exclusive || early)) {
        issues.push({ id: row.id, title: row.title, code: "hidden-vip", message: "Titre masqué portant encore des droits VIP (aucun impact public)." });
      }
    }

    return json({
      checked: result.results.length,
      inconsistent: new Set(issues.map(issue => issue.id)).size,
      issues,
      readOnly: true,
    });
  } catch {
    return json({ error: "Impossible d’auditer les droits VIP pour le moment." }, 503);
  }
}
