import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatKES } from "@/lib/pricing";
import { StatusPill } from "@/components/StatusPill";
import { AccountProfile } from "@/components/AccountProfile";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "My jobs — FundiNow" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user, isArtisan } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (isArtisan) nav({ to: "/artisan" }); }, [isArtisan, nav]);
  const { data: jobs = [], error } = useQuery({
    queryKey: ["my-jobs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("*").eq("customer_id", user!.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  return (
    <div>
      {user && <AccountProfile userId={user.id} />}
      <div className="mt-6 flex items-center justify-between">
        <h1 className="text-3xl font-extrabold">My jobs</h1>
        <Link to="/request" className="rounded-full bg-primary px-5 py-2.5 font-bold text-primary-foreground shadow-glow">Get Help Now</Link>
      </div>
      <div className="mt-6 space-y-3">
        {error && <p role="alert" className="rounded-2xl bg-destructive/10 p-5 text-destructive">Your jobs could not be loaded. Refresh the page to try again.</p>}
        {!error && jobs.length === 0 && <p className="rounded-2xl bg-card p-8 text-center text-muted-foreground">No jobs yet. Request your first fundi.</p>}
        {jobs.map((j) => (
          <Link key={j.id} to="/jobs/$id" params={{ id: j.id }} className="flex items-center justify-between rounded-2xl bg-card p-5 shadow-soft hover:ring-2 hover:ring-primary">
            <div>
              <p className="font-bold">{j.category}</p>
              <p className="line-clamp-1 text-sm text-muted-foreground">{j.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(j.created_at).toLocaleString()} · {formatKES(j.price_estimate)}</p>
            </div>
            <StatusPill s={j.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}
