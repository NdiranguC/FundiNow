import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "customer" | "artisan";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      let resolvedUser: User | null = null;
      try {
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError && authError.name !== "AuthSessionMissingError") throw authError;
        if (!active) return;
        resolvedUser = data.user;
        setUser(resolvedUser);
        if (resolvedUser) {
          const { data: roleRows, error: rolesError } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", resolvedUser.id);
          if (rolesError) throw rolesError;
          if (active) setRoles((roleRows ?? []).map((row) => row.role as Role));
        } else {
          setRoles([]);
        }
        if (active) setError(null);
      } catch (cause) {
        if (active) {
          console.error("Could not load the current account", cause);
          setUser(resolvedUser);
          setRoles([]);
          setError(cause instanceof Error ? cause.message : "Could not load the current account");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((e) => {
      if (e === "SIGNED_IN" || e === "SIGNED_OUT" || e === "USER_UPDATED") load();
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, roles, loading, error, isAdmin: roles.includes("admin"), isArtisan: roles.includes("artisan") };
}
