import { readCookie } from "../../lib/cinebox/admin-auth.mjs";

export interface AccountD1Statement { bind(...values: unknown[]): AccountD1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown>; }
export interface AccountD1Database { prepare(query: string): AccountD1Statement; batch(statements: AccountD1Statement[]): Promise<unknown>; }
export interface AccountEnv {
  DB: AccountD1Database;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
  CINEBOX_BOT_API_SECRET?: string;
  CINEBOX_ADMIN_DISCORD_USER_ID?: string;
  CINEBOX_DISCORD_BOT_TOKEN?: string;
  CINEBOX_DISCORD_GUILD_ID?: string;
  CINEBOX_DISCORD_ROLE_FONDA_ID?: string;
  CINEBOX_DISCORD_ROLE_ADMIN_ID?: string;
  CINEBOX_DISCORD_ROLE_MODO_ID?: string;
}
export const ACCOUNT_TTL = 12 * 60 * 60;
export const ACCOUNT_COOKIE = "__Host-cinebox_session";
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join("")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4)), c=>c.charCodeAt(0));
export const json = (body: unknown, status=200, headers: Record<string,string>={}) => new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...headers}});
export function secure(request: Request) { return new URL(request.url).protocol === "https:"; }
export function cookie(request: Request,name=ACCOUNT_COOKIE) { const actual=name===ACCOUNT_COOKIE&&!secure(request)?"cinebox_session":name; return readCookie(request.headers.get("cookie"),actual); }
export function cookieHeader(request: Request, name: string, value: string, maxAge: number, sameSite="Lax") {
  const actual=name===ACCOUNT_COOKIE&&!secure(request)?"cinebox_session":name;
  return [`${actual}=${value}`,"Path=/","HttpOnly",`SameSite=${sameSite}`,`Max-Age=${maxAge}`,...(secure(request)?["Secure"]:[])].join("; ");
}
export function clearCookie(request: Request,name: string,sameSite="Lax") {
  const actual=name===ACCOUNT_COOKIE&&!secure(request)?"cinebox_session":name;
  return [`${actual}=`,"Path=/","HttpOnly",`SameSite=${sameSite}`,"Max-Age=0","Expires=Thu, 01 Jan 1970 00:00:00 GMT",...(secure(request)?["Secure"]:[])].join("; ");
}
export function validOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return false;
  const site=request.headers.get("sec-fetch-site");
  return (!site || site==="same-origin") && request.headers.get("x-cinebox-request")==="1";
}
export function randomToken(bytes=32) { const value=new Uint8Array(bytes); crypto.getRandomValues(value); return b64(value); }
export async function sha256(value: string) { return b64(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)))); }
export async function createAccountSession(request: Request, env: AccountEnv, userId: string) {
const token=randomToken(32), id=crypto.randomUUID(), expiresAt=new Date(Date.now()+ACCOUNT_TTL*1000).toISOString();
  await env.DB.prepare("INSERT INTO account_sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)").bind(id,userId,await sha256(token),expiresAt).run();
  return {cookie:cookieHeader(request,ACCOUNT_COOKIE,token,ACCOUNT_TTL),expiresAt};
}
export async function getAccount(request: Request, env: AccountEnv) {
  const token=cookie(request);
  if(!token) return null;
  const row=await env.DB.prepare("SELECT u.id,u.display_name,u.role,u.email,s.expires_at FROM account_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1").bind(await sha256(token),new Date().toISOString()).first<{id:string;display_name:string;role:string;email:string|null;expires_at:string}>();
  return row;
}
export async function revokeAccount(request: Request, env: AccountEnv) {
  const token=cookie(request);
  if(token) await env.DB.prepare("UPDATE account_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=? AND revoked_at IS NULL").bind(await sha256(token)).run();
}
export async function enforceRateLimit(env: AccountEnv, request: Request, action: string, limit: number, windowSeconds: number) {
  const ip=request.headers.get("cf-connecting-ip") || "unknown";
  const key=await sha256(action+":"+ip);
  const now=Date.now();
  const windowStart=new Date(Math.floor(now/(windowSeconds*1000))*windowSeconds*1000).toISOString();
  const expiresAt=new Date(now+windowSeconds*2000).toISOString();
  const row=await env.DB.prepare("INSERT INTO account_rate_limits (rate_key,window_start,attempts,expires_at) VALUES (?,?,1,?) ON CONFLICT(rate_key,window_start) DO UPDATE SET attempts=attempts+1,expires_at=excluded.expires_at RETURNING attempts").bind(key,windowStart,expiresAt).first<{attempts:number}>();
  return Boolean(row && row.attempts<=limit);
}
