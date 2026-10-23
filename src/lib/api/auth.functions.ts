import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  verifyPassword,
} from "../auth.server";
import { query, queryOne } from "../db.server";
import { requireUser } from "./middleware";
import type { Role } from "../auth.server";
import { SITE_LANG_IDS } from "../site-lang";

export const getMe = createServerFn({ method: "GET" }).handler(async () => getSessionUser());

export const signIn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await queryOne<{ id: string; password_hash: string }>(
      "select id, password_hash from users where lower(email) = lower($1)",
      [data.email],
    );
    if (!user || !(await verifyPassword(data.password, user.password_hash))) {
      throw new Error("Invalid email or password");
    }
    await createSession(user.id);
    return getSessionUser();
  });

export const signUp = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email(),
      password: z.string().min(8, "Password must be at least 8 characters"),
      fullName: z.string().min(1).max(120),
      language: z.enum(SITE_LANG_IDS).default("en"),
    }),
  )
  .handler(async ({ data }) => {
    const exists = await queryOne("select 1 from users where lower(email) = lower($1)", [
      data.email,
    ]);
    if (exists) throw new Error("An account with this email already exists");
    const user = await queryOne<{ id: string }>(
      "insert into users (email, password_hash, full_name, language) values ($1, $2, $3, $4) returning id",
      [data.email.trim(), await hashPassword(data.password), data.fullName.trim(), data.language],
    );
    // The first account owns the farm; everyone after joins as a worker
    // until an admin promotes them.
    await query(
      `insert into user_roles (user_id, role)
       select $1, case when exists (select 1 from user_roles where role = 'admin') then 'worker' else 'admin' end::app_role`,
      [user!.id],
    );
    await createSession(user!.id);
    return getSessionUser();
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  await destroySession();
  return { ok: true };
});

// Account (profile page) ---------------------------------------------------
// Every function below acts on the signed-in user only (context.user.id from
// the session); nothing here can read or change another user's row.

const SESSION_COOKIE = "pg_session";

/** sha256 of this browser's session cookie, as stored in sessions.token_hash. */
async function currentTokenHash() {
  const { getCookie } = await import("@tanstack/react-start/server");
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface Account {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  roles: Role[];
  /** Active sessions for this account, including this one. */
  sessions: number;
}

export const getAccount = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }): Promise<Account> => {
    const row = await queryOne<{
      id: string;
      email: string;
      full_name: string | null;
      created_at: string;
      sessions: number;
    }>(
      `select u.id, u.email, u.full_name, u.created_at,
              (select count(*) from sessions s where s.user_id = u.id and s.expires_at > now())::int as sessions
         from users u where u.id = $1`,
      [context.user.id],
    );
    if (!row) throw new Error("Account not found");
    return { ...row, roles: context.user.roles };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      fullName: z.string().trim().min(1, "Enter your name").max(120, "Use 120 characters or fewer"),
    }),
  )
  .handler(async ({ data, context }) => {
    await query("update users set full_name = $1 where id = $2", [data.fullName, context.user.id]);
    return { ok: true, fullName: data.fullName };
  });

/** The language the site is shown in, for this account on every device. */
export const setMyLanguage = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(z.object({ language: z.enum(SITE_LANG_IDS) }))
  .handler(async ({ data, context }) => {
    await query("update users set language = $1 where id = $2", [data.language, context.user.id]);
    return { ok: true, language: data.language };
  });

export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator(
    z.object({
      current: z.string().min(1, "Enter your current password"),
      next: z.string().min(8, "Use at least 8 characters").max(200),
      signOutOthers: z.boolean().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const row = await queryOne<{ password_hash: string }>(
      "select password_hash from users where id = $1",
      [context.user.id],
    );
    if (!row || !(await verifyPassword(data.current, row.password_hash))) {
      throw new Error("Current password is incorrect");
    }
    if (data.current === data.next) throw new Error("Choose a password you haven't used here");
    await query("update users set password_hash = $1 where id = $2", [
      await hashPassword(data.next),
      context.user.id,
    ]);
    let signedOut = 0;
    if (data.signOutOthers) {
      const keep = await currentTokenHash();
      const rows = await query<{ token_hash: string }>(
        "delete from sessions where user_id = $1 and token_hash <> coalesce($2, '') returning token_hash",
        [context.user.id, keep],
      );
      signedOut = rows.length;
    }
    return { ok: true, signedOut };
  });

export const signOutOtherSessions = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const keep = await currentTokenHash();
    if (!keep) throw new Error("No active session");
    const rows = await query<{ token_hash: string }>(
      "delete from sessions where user_id = $1 and token_hash <> $2 returning token_hash",
      [context.user.id, keep],
    );
    return { ok: true, signedOut: rows.length };
  });
