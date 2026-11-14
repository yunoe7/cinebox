import type { Title } from "./types";

export const VIP_EARLY_ACCESS_HOURS: number;

export type VipAccessMode = "public" | "vip-exclusive" | "early-access";
export type VipAccessState = "public" | "early" | "vip";
export type ViewerEntitlements = {
  vip?: boolean;
  admin?: boolean;
  authenticated?: boolean;
};

export type VipFlagsInput = {
  vipExclusive?: unknown;
  vipEarlyAccess?: unknown;
  publicAt?: unknown;
};

export type NormalizedVipFlags = {
  vipExclusive: boolean;
  vipEarlyAccess: boolean;
  publicAt: string | null;
  publicAtMs: number | null;
};

export function parsePublicAt(value: unknown): number | null;
export function normalizeVipFlags(row?: VipFlagsInput): NormalizedVipFlags;
export function accessMode(row?: VipFlagsInput): VipAccessMode;
export function vipAccessState(row?: VipFlagsInput, now?: number): VipAccessState;
export function viewerIsEntitled(viewer: ViewerEntitlements | null | undefined): boolean;
export function canAccessContent(row: VipFlagsInput, viewer: ViewerEntitlements | null | undefined, now?: number): boolean;
export function catalogVisibilitySql(
  entitled: boolean,
  options?: { now?: string; prefix?: string },
): { sql: string; params: string[] };
export function validateVipSettings(input: VipFlagsInput):
  | { ok: true; value: { vipExclusive: boolean; vipEarlyAccess: boolean; publicAt: string | null } }
  | { ok: false; error: string };
export function vipStatusLabel(row?: VipFlagsInput, now?: number): {
  state: VipAccessState;
  mode: VipAccessMode;
  label: string;
};
export function sanitizeTitleForViewer<T>(title: T, viewer: ViewerEntitlements | null | undefined, now?: number): T;
export function filterAccessibleTitles<T>(titles: T[], viewer: ViewerEntitlements | null | undefined, now?: number): T[];
export function applySharedVipRestrictions<T extends Title, S extends Title>(
  localTitles: T[],
  sharedTitles: S[],
): T[];
