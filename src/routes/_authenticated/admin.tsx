import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatKES } from "@/lib/pricing";
import { StatusPill } from "@/components/StatusPill";
import { AdminAnalytics } from "@/components/AdminAnalytics";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — FundiNow" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<
    "overview" | "analytics" | "artisans" | "customers" | "users" | "jobs" | "disputes"
  >("overview");
  const { data, error } = useQuery({
    queryKey: ["admin"],
    enabled: isAdmin,
    queryFn: async () => {
      const [jobs, artisans, profiles, roles, disputes, settings] = await Promise.all([
        supabase.from("jobs").select("*").order("created_at", { ascending: false }),
        supabase.from("artisans").select("*"),
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("*"),
        supabase.from("disputes").select("*").order("created_at", { ascending: false }),
        supabase.from("settings").select("*").maybeSingle(),
      ]);
      if (jobs.error) throw jobs.error;
      if (artisans.error) throw artisans.error;
      if (profiles.error) throw profiles.error;
      if (roles.error) throw roles.error;
      if (disputes.error) throw disputes.error;
      if (settings.error) throw settings.error;
      return { jobs: jobs.data ?? [], artisans: artisans.data ?? [], profiles: profiles.data ?? [], roles: roles.data ?? [], disputes: disputes.data ?? [], settings: settings.data };
    },
  });
  const [pct, setPct] = useState(15);
  useEffect(() => { if (data?.settings) setPct(data.settings.commission_pct); }, [data?.settings]);

  if (loading) return null;
  if (!isAdmin) return <p className="rounded-2xl bg-card p-8 text-muted-foreground">Admins only.</p>;
  if (error) return <p role="alert" className="rounded-2xl bg-destructive/10 p-8 text-destructive">Admin data could not be loaded. Refresh the page to try again.</p>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;

  const name = (id: string | null) => data.profiles.find((p) => p.id === id)?.full_name || "—";
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const paid = data.jobs.filter((j) => j.payment_status === "paid");
  const gmv = paid.reduce((s, j) => s + j.price_estimate, 0);
  const commission = Math.round((gmv * (data.settings?.commission_pct ?? 15)) / 100);
  const completed = data.jobs.filter((j) => j.status === "completed").length;
  const conversion = data.jobs.length ? Math.round((completed / data.jobs.length) * 100) : 0;
  const isStalled = (job: (typeof data.jobs)[number]) => {
    const age = Date.now() - new Date(job.created_at).getTime();
    return (job.status === "pending" && age > 30 * 60 * 1000)
      || (job.status === "accepted" && age > 45 * 60 * 1000)
      || (["en_route", "in_progress"].includes(job.status) && age > 24 * 60 * 60 * 1000);
  };
  const stalledJobs = data.jobs.filter(isStalled);
  const card = "rounded-3xl bg-card p-6 shadow-soft";
  const openDocs = async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("artisan-docs").createSignedUrl(path, 600);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {(
          ["overview", "analytics", "artisans", "customers", "users", "jobs", "disputes"] as const
        ).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-bold capitalize ${tab === t ? "bg-primary text-primary-foreground" : "bg-card"}`}
          >
            {t}
            {t === "disputes" && ` (${data.disputes.filter((d) => d.status === "open").length})`}
          </button>
        ))}
      </div>

      {tab === "analytics" && <AdminAnalytics profiles={data.profiles} />}

      {tab === "overview" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[["Bookings", data.jobs.length], ["Completion rate", `${conversion}%`], ["Paid volume", formatKES(gmv)], ["Commission revenue", formatKES(commission)], ["Customers", data.roles.filter((r) => r.role === "customer").length], ["Fundis", data.artisans.length], ["Online now", data.artisans.filter((a) => a.is_online && a.last_active_at && Date.now() - new Date(a.last_active_at).getTime() <= 10 * 60 * 1000).length], ["Awaiting verification", data.artisans.filter((a) => !a.verified).length], ["Stalled jobs", stalledJobs.length]].map(([k, v]) => (
              <div key={k} className={card}><p className="text-sm text-muted-foreground">{k}</p><p className="mt-1 text-2xl font-extrabold">{v}</p></div>
            ))}
          </div>
          <div className={card}>
            <h2 className="text-xl font-extrabold">Commission</h2>
            <div className="mt-3 flex items-center gap-2">
              <input type="number" min={0} max={50} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-24 rounded-xl border border-input px-3 py-2" /> <span>%</span>
              <button onClick={async () => { const { error } = await supabase.from("settings").update({ commission_pct: pct }).eq("id", 1); if (error) toast.error(error.message); else { toast.success("Saved"); refresh(); } }} className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground">Save</button>
            </div>
          </div>
        </>
      )}

      {tab === "artisans" && (
        <div className={`${card} space-y-2`}>
          {data.artisans.map((a) => (
            <div key={a.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4">
              <div><p className="font-bold">{name(a.user_id)} · {a.category}</p><p className="text-xs text-muted-foreground">★ {Number(a.rating).toFixed(1)} · {a.is_online ? "online" : "offline"} · ID {a.id_doc_path ? "uploaded" : "missing"}</p></div>
              <div className="flex gap-2">
                {a.id_doc_path && <button onClick={() => openDocs(a.id_doc_path)} className="rounded-full border border-border px-3 py-1.5 text-sm">View ID</button>}
                {a.cert_path && <button onClick={() => openDocs(a.cert_path)} className="rounded-full border border-border px-3 py-1.5 text-sm">Certificate</button>}
                <button onClick={async () => { const { error } = await supabase.from("artisans").update({ verified: !a.verified }).eq("user_id", a.user_id); if (error) toast.error(error.message); else refresh(); }} className={`rounded-full px-3 py-1.5 text-sm font-bold ${a.verified ? "bg-muted" : "bg-primary text-primary-foreground"}`}>{a.verified ? "Unverify" : "Verify"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "customers" && (
        <div className={`${card} space-y-2`}>
          {data.profiles.filter((p) => data.roles.some((r) => r.user_id === p.id && r.role === "customer")).map((p) => {
            const jobs = data.jobs.filter((j) => j.customer_id === p.id);
            const spent = jobs.filter((j) => j.payment_status === "paid").reduce((s, j) => s + j.price_estimate, 0);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-4 text-sm">
                <span className="font-bold">{p.full_name || "—"} <span className="font-normal text-muted-foreground">{p.phone}</span></span>
                <span className="text-muted-foreground">{jobs.length} job{jobs.length === 1 ? "" : "s"} · {formatKES(spent)} paid</span>
              </div>
            );
          })}
          {data.roles.filter((r) => r.role === "customer").length === 0 && <p className="text-muted-foreground">No customers yet.</p>}
        </div>
      )}

      {tab === "users" && (
        <div className={`${card} space-y-2`}>
          {data.profiles.map((p) => (
            <div key={p.id} className="flex justify-between rounded-xl border border-border p-4 text-sm">
              <span className="font-bold">{p.full_name || "—"} <span className="font-normal text-muted-foreground">{p.phone}</span></span>
              <span className="capitalize text-muted-foreground">{data.roles.filter((r) => r.user_id === p.id).map((r) => r.role).join(", ")}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "jobs" && (
        <div className={`${card} space-y-2`}>
          {data.jobs.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4 text-sm">
              <Link to="/jobs/$id" params={{ id: j.id }} className="min-w-0 flex-1 hover:text-primary">
                <span><b>{j.category}</b> · {name(j.customer_id)} → {name(j.artisan_id)} · {formatKES(j.price_estimate)} · {j.payment_status}</span>
              </Link>
              <div className="flex items-center gap-2">
                {isStalled(j) && <span className="rounded-full bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive">Needs attention</span>}
                <StatusPill s={j.status} />
                {isStalled(j) && j.status !== "cancelled" && j.status !== "completed" && (
                  <button
                    onClick={async () => {
                      if (!window.confirm("Mark this stalled job as cancelled?")) return;
                      const { error } = await supabase.from("jobs").update({ status: "cancelled" }).eq("id", j.id);
                      if (error) toast.error(error.message);
                      else {
                        toast.success("Job marked cancelled.");
                        refresh();
                      }
                    }}
                    className="rounded-full border border-border px-3 py-1.5 font-semibold"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "disputes" && (
        <div className={`${card} space-y-2`}>
          {data.disputes.length === 0 && <p className="text-muted-foreground">No disputes.</p>}
          {data.disputes.map((d) => (
            <div key={d.id} className="rounded-xl border border-border p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span><b>{name(d.raised_by)}</b> · {d.report_type.replace("_", " ")}{d.reported_user_id && ` · About ${name(d.reported_user_id)}`}: {d.reason}</span>
                <span className="capitalize">{d.status}</span>
              </div>
              <div className="mt-2 flex gap-2">
                <Link to="/jobs/$id" params={{ id: d.job_id }} className="rounded-full border border-border px-3 py-1.5">Open job</Link>
                {d.status === "open" && <button onClick={async () => { const { error } = await supabase.from("disputes").update({ status: "resolved" }).eq("id", d.id); if (error) toast.error(error.message); else refresh(); }} className="rounded-full bg-primary px-3 py-1.5 font-bold text-primary-foreground">Mark resolved</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
