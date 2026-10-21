import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import {
  Download,
  Eye,
  Users,
  UserCheck,
  Radio,
  ArrowUpRight,
  ArrowDownRight,
  Repeat,
  Smartphone,
  Monitor,
  Tablet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Profile = { id: string; full_name: string | null };
const DAY = 86400000;

export function AdminAnalytics({ profiles }: { profiles: Profile[] }) {
  const [days, setDays] = useState(7);
  const {
    data: funnelEvents = [],
    isLoading: funnelLoading,
    error: funnelError,
  } = useQuery({
    queryKey: ["admin-analytics-funnel", days],
    refetchInterval: 60000,
    queryFn: async () => {
      const since = new Date(Date.now() - days * DAY).toISOString();
      const { data, error } = await supabase
        .from("analytics_events")
        .select("event_type, entity_id, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10000);
      if (error) throw error;
      return data;
    },
  });
  const {
    data: all = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin-analytics", days],
    refetchInterval: 60000,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 2 * DAY).toISOString();
      const { data, error } = await supabase
        .from("page_views")
        .select("id,created_at,visitor_id,user_id,path,device,referrer")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10000);
      if (error) throw error;
      return data;
    },
  });

  const s = useMemo(() => {
    const cut = Date.now() - days * DAY;
    const views = all.filter((v) => new Date(v.created_at).getTime() >= cut);
    const prev = all.filter((v) => new Date(v.created_at).getTime() < cut);
    const uniq = (a: typeof all) => new Set(a.map((v) => v.visitor_id)).size;
    const members = (a: typeof all) =>
      new Set(a.filter((v) => v.user_id).map((v) => v.user_id)).size;
    const prevIds = new Set(prev.map((v) => v.visitor_id));
    const curIds = [...new Set(views.map((v) => v.visitor_id))];
    const returning = curIds.filter((id) => prevIds.has(id)).length;
    const live = new Set(
      views
        .filter((v) => Date.now() - new Date(v.created_at).getTime() < 5 * 60000)
        .map((v) => v.visitor_id),
    ).size;
    const perVisitor = curIds.length ? views.length / curIds.length : 0;

    let series: { label: string; views: number; visitors: number }[];
    if (days === 1) {
      series = Array.from({ length: 24 }, (_, i) => {
        const start = Date.now() - (23 - i) * 3600000;
        const h = new Date(start).getHours();
        const inH = views.filter((v) => {
          const t = new Date(v.created_at);
          return t.getHours() === h && Date.now() - t.getTime() < 24 * 3600000;
        });
        return {
          label: `${String(h).padStart(2, "0")}:00`,
          views: inH.length,
          visitors: uniq(inH),
        };
      });
    } else {
      series = Array.from({ length: days }, (_, i) => {
        const d = new Date(Date.now() - (days - 1 - i) * DAY);
        const key = d.toDateString();
        const inD = views.filter((v) => new Date(v.created_at).toDateString() === key);
        return {
          label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
          views: inD.length,
          visitors: uniq(inD),
        };
      });
    }
    const count = (key: (v: (typeof all)[number]) => string, n = 6) => {
      const m = new Map<string, number>();
      views.forEach((v) => m.set(key(v), (m.get(key(v)) ?? 0) + 1));
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    };
    const hours = Array.from(
      { length: 24 },
      (_, h) => views.filter((v) => new Date(v.created_at).getHours() === h).length,
    );
    return {
      views,
      series,
      hours,
      live,
      returning,
      perVisitor,
      kpi: {
        views: [views.length, prev.length] as [number, number],
        visitors: [uniq(views), uniq(prev)] as [number, number],
        members: [members(views), members(prev)] as [number, number],
      },
      pages: count((v) => v.path),
      refs: count((v) => v.referrer || "Direct"),
      devices: count((v) => v.device || "unknown", 3),
    };
  }, [all, days]);

  const name = (id: string | null) =>
    id ? profiles.find((p) => p.id === id)?.full_name || "Member" : "Guest";
  const card = "rounded-3xl border border-border bg-card p-6 shadow-soft";

  const exportCsv = () => {
    const rows = [
      ["time", "visitor", "member", "page", "device", "source"],
      ...s.views.map((v) => [
        v.created_at,
        v.visitor_id,
        name(v.user_id),
        v.path,
        v.device ?? "",
        v.referrer ?? "Direct",
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `visits-${days}d.csv`;
    a.click();
  };

  const Delta = ({ cur, prev }: { cur: number; prev: number }) => {
    if (!prev) return <span className="text-xs text-muted-foreground">no earlier data</span>;
    const pct = Math.round(((cur - prev) / prev) * 100);
    const up = pct >= 0;
    return (
      <span
        className={`inline-flex items-center gap-0.5 text-xs font-bold ${up ? "text-primary" : "text-destructive"}`}
      >
        {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        {Math.abs(pct)}% vs previous
      </span>
    );
  };

  const Bars = ({ title, rows }: { title: string; rows: [string, number][] }) => {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return (
      <div className={card}>
        <h3 className="font-extrabold">{title}</h3>
        <div className="mt-4 space-y-3 text-sm">
          {rows.length === 0 && <p className="text-muted-foreground">No data yet.</p>}
          {rows.map(([k, n]) => (
            <div key={k}>
              <div className="flex justify-between gap-2">
                <span className="truncate">{k}</span>
                <b>{n}</b>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const deviceIcon = (d: string) =>
    d === "mobile" ? Smartphone : d === "tablet" ? Tablet : Monitor;
  const totalDev = s.devices.reduce((a, [, n]) => a + n, 0) || 1;
  const maxHour = Math.max(1, ...s.hours);
  const countEvents = (type: string) =>
    new Set(
      funnelEvents.filter((event) => event.event_type === type).map((event) => event.entity_id),
    ).size;
  const funnel = [
    ["Signups", countEvents("signup")],
    ["Logins", funnelEvents.filter((event) => event.event_type === "login").length],
    ["Job requests", countEvents("job_requested")],
    ["Accepted", countEvents("job_accepted")],
    ["Completed", countEvents("job_completed")],
    ["Paid", countEvents("payment_confirmed")],
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold">Site analytics</h2>
          <p className="text-sm text-muted-foreground">
            Who's visiting FundiNow. Updates every 30 seconds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-muted p-1">
            {[1, 7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-full px-3 py-1.5 text-sm font-bold ${days === d ? "bg-card text-foreground shadow-soft" : "text-muted-foreground"}`}
              >
                {d === 1 ? "24h" : `${d}d`}
              </button>
            ))}
          </div>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm font-bold"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : error ? (
        <p role="alert" className="rounded-2xl bg-destructive/10 p-6 text-destructive">
          Analytics could not be loaded: {error.message}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Page views", Eye, s.kpi.views],
                ["Unique visitors", Users, s.kpi.visitors],
                ["Signed-in members", UserCheck, s.kpi.members],
              ] as const
            ).map(([k, Icon, [cur, prev]]) => (
              <div key={k} className={card}>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{k}</p>
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-2 text-3xl font-extrabold">{cur}</p>
                <Delta cur={cur} prev={prev} />
              </div>
            ))}
            <div className={card}>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">On the site now</p>
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
                </span>
              </div>
              <p className="mt-2 text-3xl font-extrabold">{s.live}</p>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Radio className="h-3 w-3" />
                active in last 5 min
              </span>
            </div>
          </div>

          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-extrabold">Signup and job funnel</h3>
              <p className="text-xs text-muted-foreground">
                Events during the selected period; payment metrics begin when a provider is
                connected.
              </p>
            </div>
            {funnelError ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                Funnel analytics could not be loaded: {funnelError.message}
              </p>
            ) : funnelLoading ? (
              <p className="mt-3 text-sm text-muted-foreground">Loading funnel data…</p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {funnel.map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-muted p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-extrabold">{value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-extrabold">{days === 1 ? "Visits by hour" : "Visits by date"}</h3>
              <p className="text-xs text-muted-foreground">
                {s.perVisitor.toFixed(1)} pages per visitor · {s.returning} returning visitors
              </p>
            </div>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={s.series} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      color: "var(--foreground)",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="views"
                    name="Page views"
                    stroke="var(--primary)"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="visitors"
                    name="Visitors"
                    stroke="var(--muted-foreground)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Bars title="Top pages" rows={s.pages} />
            <Bars title="Where visitors came from" rows={s.refs} />
            <div className={card}>
              <h3 className="font-extrabold">Devices</h3>
              <div className="mt-4 space-y-3">
                {s.devices.length === 0 && (
                  <p className="text-sm text-muted-foreground">No data yet.</p>
                )}
                {s.devices.map(([d, n]) => {
                  const I = deviceIcon(d);
                  const pct = Math.round((n / totalDev) * 100);
                  return (
                    <div key={d} className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-foreground">
                        <I className="h-4 w-4" />
                      </span>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm capitalize">
                          <span>{d}</span>
                          <b>{pct}%</b>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 border-t border-border pt-3 text-sm text-muted-foreground">
                  <Repeat className="h-4 w-4" />
                  {s.kpi.visitors[0] - s.returning} new · {s.returning} returning
                </div>
              </div>
            </div>
          </div>

          <div className={card}>
            <h3 className="font-extrabold">Busiest hours</h3>
            <p className="text-xs text-muted-foreground">
              When people visit most (your local time)
            </p>
            <div className="mt-4 grid grid-cols-12 gap-1 sm:grid-cols-24">
              {s.hours.map((n, h) => (
                <div
                  key={h}
                  title={`${h}:00 — ${n} views`}
                  className="flex flex-col items-center gap-1"
                >
                  <div
                    className="h-8 w-full rounded-md bg-primary"
                    style={{ opacity: n ? 0.15 + (n / maxHour) * 0.85 : 0.06 }}
                  />
                  <span className="text-[10px] text-muted-foreground">{h}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={card}>
            <h3 className="font-extrabold">Recent visits</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">Visitor</th>
                    <th>Page</th>
                    <th>Device</th>
                    <th>Source</th>
                    <th className="text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {s.views.slice(0, 30).map((v) => (
                    <tr key={v.id} className="border-t border-border">
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${v.user_id ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}
                        >
                          {name(v.user_id)}
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate">{v.path}</td>
                      <td className="capitalize text-muted-foreground">{v.device}</td>
                      <td className="text-muted-foreground">{v.referrer || "Direct"}</td>
                      <td className="text-right text-muted-foreground">
                        {new Date(v.created_at).toLocaleString(undefined, {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                  {s.views.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-muted-foreground">
                        No visits yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
