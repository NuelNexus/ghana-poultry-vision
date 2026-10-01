import { createMiddleware } from "@tanstack/react-start";
import { getSessionUser, type Role } from "../auth.server";

// Every data server function runs behind one of these. They replace the
// Supabase RLS policies: any signed-in user can read; writes to farm setup
// need admin or manager.

export const requireUser = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized: please sign in");
  return next({ context: { user } });
});

const managerRoles: Role[] = ["admin", "manager"];

export const requireManager = createMiddleware({ type: "function" })
  .middleware([requireUser])
  .server(async ({ next, context }) => {
    if (!context.user.roles.some((r) => managerRoles.includes(r))) {
      throw new Error("Only admins and farm managers can change this");
    }
    return next();
  });
