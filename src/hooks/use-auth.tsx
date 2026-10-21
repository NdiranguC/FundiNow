import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "customer" | "artisan";

export const authUserQueryKey = ["auth-user"] as const;
export const authRolesQueryKey = (userId: string) => ["auth-roles", userId] as const;

export async function loadAuthRoles(userId: string): Promise<Role[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.role as Role);
}

export function useAuth() {
  const userQuery = useQuery<User | null>({
    queryKey: authUserQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session?.user ?? null;
    },
    staleTime: Infinity,
    retry: false,
  });
  const rolesQuery = useQuery({
    queryKey: authRolesQueryKey(userQuery.data?.id ?? ""),
    queryFn: () => loadAuthRoles(userQuery.data!.id),
    enabled: !!userQuery.data,
    staleTime: Infinity,
    retry: false,
  });

  const user = userQuery.data ?? null;
  const roles = rolesQuery.data ?? [];
  const error = userQuery.error ?? rolesQuery.error;

  useEffect(() => {
    if (error) console.error("Could not load the current account", error);
  }, [error]);

  return {
    user,
    roles,
    loading: userQuery.isLoading || (!!user && rolesQuery.isLoading),
    error:
      error instanceof Error ? error.message : error ? "Could not load the current account" : null,
    isAdmin: roles.includes("admin"),
    isArtisan: roles.includes("artisan"),
  };
}
