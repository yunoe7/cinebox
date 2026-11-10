export const ADMIN_SESSION_COOKIE: string;
export const ADMIN_SESSION_COOKIE_DEV: string;
export const ADMIN_SESSION_TTL_SECONDS: number;
export const ADMIN_SESSION_SECRET_MIN_LENGTH: number;
export const ADMIN_PASSWORD_MIN_LENGTH: number;
export const ADMIN_PASSWORD_HASH_ALGORITHM: string;
export const ADMIN_PASSWORD_ITERATIONS_DEFAULT: number;
export const ADMIN_PASSWORD_ITERATIONS_MIN: number;
export const ADMIN_PASSWORD_ITERATIONS_MAX: number;
export const ADMIN_CSRF_HEADER: string;
export const ADMIN_CSRF_VALUE: string;

export interface ParsedPasswordHash {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

export interface AdminSession {
  token: string;
  issuedAt: number;
  expiresAt: number;
}

export type AdminSessionVerification =
  | { valid: true; issuedAt: number; expiresAt: number }
  | { valid: false; reason: string };

export function parsePasswordHash(encoded: string | null | undefined): ParsedPasswordHash | null;
export function hashAdminPassword(password: string, options?: { iterations?: number; salt?: Uint8Array }): Promise<string>;
export function verifyAdminPassword(password: string, encoded: string | null | undefined): Promise<boolean>;
export function createAdminSession(options?: { secret?: string; now?: number; ttlSeconds?: number }): Promise<AdminSession>;
export function verifyAdminSession(token: string, options?: { secret?: string; now?: number }): Promise<AdminSessionVerification>;
export function sessionCookieName(options?: { secure?: boolean }): string;
export function buildSessionCookie(token: string, options?: { secure?: boolean; maxAge?: number }): string;
export function buildClearSessionCookie(options?: { secure?: boolean }): string;
export function readCookie(cookieHeader: string | null | undefined, name: string): string;
export function requiresCsrf(method: string): boolean;
export function verifyRequestOrigin(request: Request): { ok: boolean; reason?: string };
