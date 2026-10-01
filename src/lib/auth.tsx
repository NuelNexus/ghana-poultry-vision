import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, signOut as signOutFn } from "@/lib/api/auth.functions";
import type { SessionUser, Role } from "@/lib/auth.server";

interface AuthCtx {
  user: SessionUser | null;
  roles: Role[];
  loading: boolean;
  canManage: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  roles: [],
  loading: true,
  canManage: false,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => getMe(), staleTime: 60_000 });
  const user = me.data ?? null;
  const roles = user?.roles ?? [];

  return (
    <Ctx.Provider
      value={{
        user,
        roles,
        loading: me.isPending,
        canManage: roles.includes("admin") || roles.includes("manager"),
        refresh: async () => {
          await qc.invalidateQueries({ queryKey: ["me"] });
        },
        signOut: async () => {
          await signOutFn();
          qc.setQueryData(["me"], null);
          qc.clear();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
