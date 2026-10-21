import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CATEGORIES, artisanEarnings, formatKES } from "@/lib/pricing";
import type { Database } from "@/integrations/supabase/types";
import { StatusPill } from "@/components/StatusPill";
import { AccountProfile } from "@/components/AccountProfile";

export const Route = createFileRoute("/_authenticated/artisan")({
  head: () => ({ meta: [{ title: "Artisan dashboard — FundiNow" }] }),
  component: ArtisanPage,
});

function ArtisanPage() {
  const { user, isArtisan, loading } = useAuth();
  const qc = useQueryClient();
  const { data: me, error: meError } = useQuery({
    queryKey: ["me-artisan", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artisans")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: settings, error: settingsError } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: jobs = [], error: jobsError } = useQuery({
    queryKey: ["artisan-jobs", user?.id, me?.category],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .or(
          `artisan_id.eq.${user!.id},and(artisan_id.is.null,status.eq.pending,category.eq.${me!.category})`,
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    let refreshTimer: number | undefined;
    const channel = supabase
      .channel("artisan-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
          void qc.invalidateQueries({ queryKey: ["artisan-jobs"] });
        }, 150);
      })
      .subscribe();
    return () => {
      window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  useEffect(() => {
    if (!me?.is_online) return;
    const updateActivity = async () => {
      const { error } = await supabase.rpc("mark_artisan_active");
      if (error)
        toast.error(
          "Your availability could not be refreshed. Toggle offline and online to try again.",
        );
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void updateActivity();
    };
    void updateActivity();
    const interval = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void updateActivity();
      },
      2 * 60 * 1000,
    );
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [me?.is_online]);

  const [bio, setBio] = useState("");
  useEffect(() => {
    if (me) setBio(me.bio);
  }, [me]);

  if (loading) return null;
  if (meError || settingsError || jobsError)
    return (
      <p role="alert" className="rounded-2xl bg-destructive/10 p-8 text-destructive">
        Your fundi dashboard could not load. Refresh the page to try again.
      </p>
    );
  if (!isArtisan || !me)
    return (
      <p className="rounded-2xl bg-card p-8 text-muted-foreground">
        This area is for registered fundis.
      </p>
    );

  const patch = async (p: Database["public"]["Tables"]["artisans"]["Update"]): Promise<boolean> => {
    const { error } = await supabase.from("artisans").update(p).eq("user_id", user!.id);
    if (error) {
      toast.error(error.message);
      return false;
    }
    qc.invalidateQueries({ queryKey: ["me-artisan"] });
    return true;
  };
  const toggleOnline = () => {
    if (me.is_online) {
      void patch({ is_online: false });
      return;
    }
    const goOnline = (position?: GeolocationPosition) => {
      void patch({
        is_online: true,
        last_active_at: new Date().toISOString(),
        ...(position ? { lat: position.coords.latitude, lng: position.coords.longitude } : {}),
      });
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(goOnline, () => {
        toast.error("Location is unavailable; going online without distance-based matching.");
        goOnline();
      });
    } else {
      goOnline();
    }
  };
  const upload = async (
    kind: "id_doc_path" | "cert_path" | "portfolio",
    files: FileList | null,
  ) => {
    if (!files?.length) return undefined;
    const bucket = kind === "portfolio" ? "job-media" : "artisan-docs";
    const paths: string[] = [];
    for (const f of Array.from(files)) {
      const path = `${user!.id}/${kind}-${crypto.randomUUID()}-${f.name}`;
      const { error } = await supabase.storage.from(bucket).upload(path, f);
      if (error) {
        toast.error(error.message);
        return undefined;
      }
      paths.push(path);
    }
    if (
      await patch(
        kind === "portfolio" ? { portfolio: [...me.portfolio, ...paths] } : { [kind]: paths[0] },
      )
    ) {
      toast.success("Uploaded");
    }
    return undefined;
  };
  const respond = async (jobId: string, accept: boolean) => {
    const { error } = await supabase.rpc("respond_job", { _job: jobId, _accept: accept });
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["artisan-jobs"] });
  };

  const pct = settings?.commission_pct ?? 15;
  const requests = jobs.filter((j) => j.status === "pending");
  const mine = jobs.filter((j) => j.artisan_id === user!.id && j.status !== "pending");
  const done = mine.filter((j) => j.status === "completed");
  const earned = done.reduce((s, j) => s + artisanEarnings(j.price_estimate, pct), 0);
  const card = "rounded-3xl bg-card p-6 shadow-soft";

  return (
    <div className="space-y-5">
      <AccountProfile userId={user!.id} />
      <div className={`${card} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            {me.category} fundi{" "}
            {me.verified ? (
              <span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                <ShieldCheck className="h-3 w-3" /> Verified
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Pending verification
              </span>
            )}
          </h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Star className="h-4 w-4 fill-primary text-primary" /> {Number(me.rating).toFixed(1)} ·{" "}
            {me.rating_count} reviews
          </p>
        </div>
        <button
          onClick={toggleOnline}
          className={`rounded-full px-6 py-3 font-bold ${me.is_online ? "bg-primary text-primary-foreground shadow-glow" : "bg-secondary text-secondary-foreground"}`}
        >
          {me.is_online ? "● Online" : "Go online"}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Total earnings", formatKES(earned)],
          ["Jobs completed", String(done.length)],
          ["Commission", `${pct}%`],
        ].map(([k, v]) => (
          <div key={k} className={card}>
            <p className="text-sm text-muted-foreground">{k}</p>
            <p className="mt-1 text-2xl font-extrabold">{v}</p>
          </div>
        ))}
      </div>

      <div className={card}>
        <h2 className="text-xl font-extrabold">New requests</h2>
        <div className="mt-3 space-y-2">
          {requests.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {me.is_online
                ? "No requests right now — new requests will appear here while you are online."
                : "Go online to receive requests."}
            </p>
          )}
          {requests.map((j) => (
            <div
              key={j.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
            >
              <div>
                <p className="font-bold">{j.description}</p>
                <p className="text-xs text-muted-foreground">
                  {j.address} ·{" "}
                  {j.urgency === "instant" ? "Now" : new Date(j.scheduled_at!).toLocaleString()} ·
                  you earn {formatKES(artisanEarnings(j.price_estimate, pct))}
                  {j.artisan_id && " · sent to you"}
                </p>
              </div>
              <div className="flex gap-2">
                {j.artisan_id && (
                  <button
                    onClick={() => respond(j.id, false)}
                    className="rounded-full border border-border px-4 py-2 text-sm font-semibold"
                  >
                    Decline
                  </button>
                )}
                <button
                  onClick={() => respond(j.id, true)}
                  className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
                >
                  Accept
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={card}>
        <h2 className="text-xl font-extrabold">My jobs</h2>
        <div className="mt-3 space-y-2">
          {mine.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet.</p>}
          {mine.map((j) => (
            <Link
              key={j.id}
              to="/jobs/$id"
              params={{ id: j.id }}
              className="flex items-center justify-between rounded-xl border border-border p-4 hover:border-primary"
            >
              <div>
                <p className="font-bold">{j.description}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(j.created_at).toLocaleDateString()} · {formatKES(j.price_estimate)}
                  {j.rating && ` · ★ ${j.rating}`}
                </p>
              </div>
              <StatusPill s={j.status} />
            </Link>
          ))}
        </div>
      </div>

      <div className={card}>
        <h2 className="text-xl font-extrabold">Profile & verification</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <select
            className="rounded-xl border border-input bg-card px-4 py-3"
            value={me.category}
            onChange={(e) => patch({ category: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl border border-input px-4 py-3"
              placeholder="Short bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
            <button
              onClick={() => patch({ bio })}
              className="rounded-xl bg-secondary px-4 font-bold text-secondary-foreground"
            >
              Save
            </button>
          </div>
          {(
            [
              ["id_doc_path", "National ID", me.id_doc_path],
              ["cert_path", "Skill certificate (optional)", me.cert_path],
            ] as const
          ).map(([k, l, v]) => (
            <label
              key={k}
              className="cursor-pointer rounded-xl border border-dashed border-border p-4 text-sm"
            >
              <span className="font-bold">{l}</span>{" "}
              <span className="text-muted-foreground">{v ? "✓ uploaded" : "— tap to upload"}</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => upload(k, e.target.files)}
              />
            </label>
          ))}
          <label className="cursor-pointer rounded-xl border border-dashed border-border p-4 text-sm sm:col-span-2">
            <span className="font-bold">Portfolio photos</span>{" "}
            <span className="text-muted-foreground">
              {me.portfolio.length} uploaded — tap to add
            </span>
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => upload("portfolio", e.target.files)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
