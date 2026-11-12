import { readCookie } from "../../lib/cinebox/admin-auth.mjs";

export interface AccountEnv {
  DB: D1Database;
  CINEBOX_ACCOUNT_SESSION_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
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
  const actual=name===ACCOUNT_COOKIE&&!secure(request)?"cinebox_session":name;\n  return [`${actual}=${value}`,"Path=/","HttpOnly",`SameSite=${sameSite}`,`Max-Age=${maxAge}`,...(secure(request)?["Secure"]:[])].join("; ");
}
export function clearCookie(request: Request,name: string,sameSite="Lax") {
  const actual=name===ACCOUNT_COOKIE&&!secure(request)?"cinebox_session":name;\n  return [`${actual}=`,"Path=/","HttpOnly",`SameSite=${sameSite}`,"Max-Age=0","Expires=Thu, 01 Jan 1970 00:00:00 GMT",...(secure(request)?["Secure"]:[])].join("; ");
}
export function validOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return false;
  const site=request.headers.get("sec-fetch-site");
  return (!site || site==="same-origin") && request.headers.get("x-cinebox-request")==="1";
}
export function randomToken(bytes=32) { const value=new Uint8Array(bytes); crypto.getRandomValues(value); return b64(value); }
export async function sha256(value: string) { return b64(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)))); }
export async function passwordHash(password: string) {
  const salt=new Uint8Array(16); crypto.getRandomValues(salt);
  const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:100000},key,256);
  return `pbkdf2-sha256$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm,iterationsText,saltText,hashText]=encoded.split("$");
  const iterations=Number(iterationsText);
  if(algorithm!=="pbkdf2-sha256" || iterations!==100000) return false;
  try {
    const salt=unb64(saltText), expected=unb64(hashText);
    const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);
    const bits=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations},key,256));
    if(bits.length!==expected.length) return false;
    let diff=0; for(let i=0;i<bits.length;i++) diff|=bits[i]^expected[i];
    return diff===0;
  } catch { return false; }
}
export async function createAccountSession(request: Request, env: AccountEnv, userId: string) {
  if(!env.CINEBOX_ACCOUNT_SESSION_SECRET || env.CINEBOX_ACCOUNT_SESSION_SECRET.length<32) throw new Error("account-session-secret");
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
export function normalizeEmail(value: unknown) {
  return typeof value==="string" ? value.trim().toLowerCase() : "";
}
