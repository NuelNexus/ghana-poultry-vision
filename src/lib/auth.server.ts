import process from "node:process";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { query, queryOne } from "./db.server";

// Email/password auth backed by Neon (replaces Supabase Auth).
// Passwords: PBKDF2-SHA256 via Web Crypto (works on Node and Cloudflare Workers).
// Sessions: random token in an httpOnly cookie; only its SHA-256 is stored.

export type Role = "admin" | "manager" | "worker";
export interface SessionUser {
  id: string;
  email: string;
  full_name: string | null;
  roles: Role[];
}

const COOKIE = "pg_session";
const SESSION_DAYS = 30;
const ITERATIONS = 100_000; // Cloudflare Workers' PBKDF2 maximum

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const actual = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function sha256(s: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSession(userId: string) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(
    /[+/=]/g,
    (c) => ({ "+": "-", "/": "_", "=": "" })[c]!,
  );
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [
    await sha256(token),
    userId,
    expires.toISOString(),
  ]);
  setCookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const token = getCookie(COOKIE);
  if (token) await query("delete from sessions where token_hash = $1", [await sha256(token)]);
  deleteCookie(COOKIE, { path: "/" });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = getCookie(COOKIE);
  if (!token) return null;
  const row = await queryOne<{
    id: string;
    email: string;
    full_name: string | null;
    roles: Role[] | null;
  }>(
    `select u.id, u.email, u.full_name,
            coalesce(array_agg(r.role::text) filter (where r.role is not null), '{}') as roles
       from sessions s
       join users u on u.id = s.user_id
       left join user_roles r on r.user_id = u.id
      where s.token_hash = $1 and s.expires_at > now()
      group by u.id`,
    [await sha256(token)],
  );
  return row ? { ...row, roles: row.roles ?? [] } : null;
}
