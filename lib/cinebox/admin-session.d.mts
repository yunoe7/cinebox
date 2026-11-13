export const ADMIN_SESSION_ENDPOINT: string;
export const ADMIN_LOGIN_ENDPOINT: string;
export const ADMIN_LOGOUT_ENDPOINT: string;
export const ADMIN_CSRF_HEADER: string;
export const ADMIN_CSRF_VALUE: string;

export interface AdminSessionState {
  authenticated: boolean;
  expiresAt: number | null;
}

export class AdminAuthError extends Error {
  constructor(message: string, status?: number);
  status: number;
}

export function isAdminAuthError(reason: unknown): reason is AdminAuthError;
export function getAdminSession(): Promise<AdminSessionState>;
export function loginAdmin(): Promise<void>;
export function logoutAdmin(): Promise<void>;
export function adminFetch(path: string, init?: RequestInit): Promise<Response>;
export function adminJson<T = unknown>(path: string, init?: RequestInit): Promise<T>;
