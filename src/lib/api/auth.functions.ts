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
    }),
  )
  .handler(async ({ data }) => {
    const exists = await queryOne("select 1 from users where lower(email) = lower($1)", [
      data.email,
    ]);
    if (exists) throw new Error("An account with this email already exists");
    const user = await queryOne<{ id: string }>(
      "insert into users (email, password_hash, full_name) values ($1, $2, $3) returning id",
      [data.email.trim(), await hashPassword(data.password), data.fullName.trim()],
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
