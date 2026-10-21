import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Phone, Send, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatKES } from "@/lib/pricing";
import { GoogleMap } from "@/components/GoogleMap";
import { JobConstructionWorkflow } from "@/components/JobConstructionWorkflow";
import type { Database } from "@/integrations/supabase/types";
import { StatusPill } from "@/components/StatusPill";

export const Route = createFileRoute("/_authenticated/jobs/$id")({
  head: () => ({ meta: [{ title: "Job — FundiNow" }] }),
  component: JobPage,
});

const NEXT: Record<string, { to: string; label: string }> = {
  accepted: { to: "en_route", label: "I'm on my way" },
  en_route: { to: "in_progress", label: "Arrived — start job" },
  in_progress: { to: "completed", label: "Mark job complete" },
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function JobPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();

  const {
    data: job,
    error: jobError,
    isPending: jobPending,
  } = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: people, error: peopleError } = useQuery({
    queryKey: ["job-people", job?.customer_id, job?.artisan_id],
    enabled: !!job,
    queryFn: async () => {
      const ids = [job!.customer_id, job!.artisan_id].filter(Boolean) as string[];
      const { data: p, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .in("id", ids);
      if (profileError) throw profileError;
      const { data: a, error: artisanError } = job!.artisan_id
        ? await supabase.from("artisans").select("*").eq("user_id", job!.artisan_id).maybeSingle()
        : { data: null, error: null };
      if (artisanError) throw artisanError;
      return {
        customer: p?.find((x) => x.id === job!.customer_id),
        artisanProfile: p?.find((x) => x.id === job!.artisan_id),
        artisan: a,
      };
    },
  });
  const {
    data: photos = [],
    error: photosError,
    refetch: retryPhotos,
  } = useQuery({
    queryKey: ["job-photos", job?.photos],
    enabled: !!job?.photos?.length,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("job-media")
        .createSignedUrls(job!.photos, 3600);
      if (error) throw error;
      return data.map((item) => item.signedUrl).filter((url): url is string => !!url);
    },
  });
  const {
    data: messages = [],
    error: messagesError,
    refetch: retryMessages,
  } = useQuery({
    queryKey: ["messages", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id,job_id,sender_id,body,created_at")
        .eq("job_id", id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`job-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs", filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["job", id] }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `job_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["messages", id] }),
      );
    if (job?.artisan_id) {
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "artisans",
          filter: `user_id=eq.${job.artisan_id}`,
        },
        () =>
          void qc.invalidateQueries({
            queryKey: ["job-people", job.customer_id, job.artisan_id],
            exact: true,
          }),
      );
    }
    const ch = channel.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, job?.artisan_id, job?.customer_id, qc]);

  const isArtisan = !!user && job?.artisan_id === user.id;
  const isCustomer = !!user && job?.customer_id === user.id;

  // Share live location while travelling and on site
  useEffect(() => {
    if (
      !isArtisan ||
      !["en_route", "in_progress"].includes(job?.status ?? "") ||
      !navigator.geolocation
    )
      return;
    const w = navigator.geolocation.watchPosition(
      (p) => {
        const next = { lat: p.coords.latitude, lng: p.coords.longitude };
        const now = Date.now();
        const previous = lastSharedLocation.current;
        if (
          previous &&
          haversineKm(previous.lat, previous.lng, next.lat, next.lng) < 0.1 &&
          now - previous.at < 30_000
        ) {
          return;
        }
        lastSharedLocation.current = { ...next, at: now };
        void supabase
          .from("artisans")
          .update(next)
          .eq("user_id", user!.id)
          .then(({ error }) => {
            if (error) {
              lastSharedLocation.current = null;
              console.error("Could not share live fundi location", error);
            }
          });
      },
      (error) => console.error("Live location tracking failed", error),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(w);
  }, [isArtisan, job?.status, user]);

  const [msg, setMsg] = useState("");
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState("");
  const [reviewPublic, setReviewPublic] = useState(false);
  const [dispute, setDispute] = useState("");
  const [reportType, setReportType] = useState<"job_issue" | "service_quality" | "safety">(
    "job_issue",
  );
  const [reportedUserId, setReportedUserId] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [sending, setSending] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const lastSharedLocation = useRef<{ lat: number; lng: number; at: number } | null>(null);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (jobError)
    return (
      <p role="alert" className="rounded-2xl bg-destructive/10 p-8 text-destructive">
        This job could not be loaded. You may not have access, or the service may be unavailable.
      </p>
    );
  if (!job)
    return (
      <p className="text-muted-foreground">
        {jobPending ? "Loading job…" : "Job not found or unavailable."}
      </p>
    );

  const update = async (patch: Database["public"]["Tables"]["jobs"]["Update"]) => {
    const { error } = await supabase.from("jobs").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["job", id] });
  };
  const reschedule = async () => {
    const time = new Date(scheduleDate);
    if (rescheduling || !scheduleDate || Number.isNaN(time.getTime()) || time <= new Date()) {
      toast.error("Choose a future appointment time.");
      return;
    }
    setRescheduling(true);
    try {
      const { error } = await supabase.rpc("reschedule_job", {
        _job: id,
        _scheduled_at: time.toISOString(),
      });
      if (error) toast.error(error.message);
      else {
        toast.success("Appointment updated.");
        await qc.invalidateQueries({ queryKey: ["job", id] });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The job could not be rescheduled.");
    } finally {
      setRescheduling(false);
    }
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msg.trim() || sending) return;
    const body = msg;
    setSending(true);
    try {
      const { error } = await supabase
        .from("messages")
        .insert({ job_id: id, sender_id: user!.id, body });
      if (error) toast.error(error.message);
      else setMsg("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message could not be sent. Try again.");
    } finally {
      setSending(false);
    }
  };
  const other = isArtisan ? people?.customer : people?.artisanProfile;
  const a = people?.artisan;
  const live = a?.lat != null && a?.lng != null && ["en_route", "in_progress"].includes(job.status);
  const card = "rounded-3xl bg-card p-6 shadow-soft";

  // Rough estimate based on straight-line distance, not live traffic routing.
  const etaMin =
    live && job.lat != null && job.lng != null
      ? Math.max(2, Math.round((haversineKm(a!.lat!, a!.lng!, job.lat, job.lng) / 25) * 60))
      : null;
  const arrivalAt = etaMin != null ? new Date(Date.now() + etaMin * 60_000) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <div className={card}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-primary">{job.category}</p>
              <h1 className="mt-1 text-2xl font-extrabold">{job.description}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {job.address} ·{" "}
                {job.urgency === "instant" ? "Now" : new Date(job.scheduled_at!).toLocaleString()}
              </p>
            </div>
            <StatusPill s={job.status} />
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-muted p-4">
            <span className="text-sm text-muted-foreground">
              Price {job.payment_status === "paid" && `· paid via ${job.payment_method}`}
            </span>
            <span className="text-xl font-extrabold">{formatKES(job.price_estimate)}</span>
          </div>
          {photos.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {photos.map((u) => (
                <img
                  key={u}
                  src={u}
                  alt="Job"
                  loading="lazy"
                  className="aspect-square rounded-xl object-cover"
                />
              ))}
            </div>
          )}
          {photosError && (
            <div
              role="alert"
              className="mt-3 flex items-center justify-between gap-2 text-sm text-destructive"
            >
              <span>Job photos could not be loaded.</span>
              <button onClick={() => void retryPhotos()} className="font-bold underline">
                Retry
              </button>
            </div>
          )}
        </div>
        {peopleError && (
          <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
            Participant details could not be loaded.
          </p>
        )}

        {live ? (
          <div>
            <GoogleMap
              markers={[
                {
                  lat: a!.lat!,
                  lng: a!.lng!,
                  label: `${people?.artisanProfile?.full_name ?? "Fundi"} — live`,
                  color: "#22c55e",
                },
                ...(job.lat != null && job.lng != null
                  ? [{ lat: job.lat, lng: job.lng, label: "Job location", color: "#1f2937" }]
                  : []),
              ]}
              center={{ lat: a!.lat!, lng: a!.lng! }}
              zoom={15}
              className="h-80"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1 text-xs text-primary">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" /> Live
                — {people?.artisanProfile?.full_name ?? "your fundi"} is on the way
              </p>
              {etaMin != null && arrivalAt && (
                <p className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                  Approx. {etaMin} min · around{" "}
                  {arrivalAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          </div>
        ) : job.lat != null && job.lng != null ? (
          <GoogleMap
            markers={[{ lat: job.lat, lng: job.lng, label: "Job location", color: "#1f2937" }]}
            center={{ lat: job.lat, lng: job.lng }}
            className="h-64"
          />
        ) : null}

        <JobConstructionWorkflow
          job={job}
          isArtisan={isArtisan}
          isCustomer={isCustomer}
          customerName={people?.customer?.full_name || "Customer"}
          artisanName={people?.artisanProfile?.full_name || "Fundi"}
        />

        <div className={card}>
          {job.status === "pending" && (
            <p className="text-muted-foreground">
              {job.artisan_id
                ? "Waiting for the fundi to accept…"
                : "Waiting for a verified fundi to accept your request…"}
            </p>
          )}
          {isArtisan && NEXT[job.status] && (
            <button
              onClick={() => update({ status: NEXT[job.status]!.to })}
              className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground shadow-glow"
            >
              {NEXT[job.status]!.label}
            </button>
          )}
          {isCustomer && ["pending", "accepted"].includes(job.status) && (
            <div className="mt-4 space-y-3 rounded-xl bg-muted p-4">
              <h2 className="font-bold">Need to change your plans?</h2>
              <p className="text-sm text-muted-foreground">
                Rescheduling changes this request to a scheduled job and removes the instant-callout
                surcharge.
              </p>
              <label className="block text-sm font-semibold" htmlFor="reschedule-time">
                New appointment time
              </label>
              <input
                id="reschedule-time"
                type="datetime-local"
                min={new Date(Date.now() + 60_000 - new Date().getTimezoneOffset() * 60_000)
                  .toISOString()
                  .slice(0, 16)}
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                className="w-full rounded-xl border border-input bg-card px-3 py-2"
              />
              <button
                onClick={reschedule}
                disabled={!scheduleDate || rescheduling}
                className="w-full rounded-xl border border-border bg-card py-2.5 font-semibold disabled:opacity-50"
              >
                {rescheduling ? "Saving…" : "Reschedule job"}
              </button>
              <button
                onClick={() => {
                  if (window.confirm("Cancel this job request?"))
                    void update({ status: "cancelled" });
                }}
                className="w-full rounded-xl border border-border py-2.5 font-semibold"
              >
                Cancel request
              </button>
            </div>
          )}
          {isCustomer && job.status === "completed" && job.payment_status === "unpaid" && (
            <div>
              <h2 className="font-extrabold">Payment pending · {formatKES(job.price_estimate)}</h2>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {["M-Pesa", "Card", "Cash"].map((m) => (
                  <button
                    key={m}
                    disabled
                    className="cursor-not-allowed rounded-xl border border-border py-3 font-bold opacity-50"
                  >
                    {m}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Payments are not available yet. Your balance will remain unpaid until a payment
                provider is connected.
              </p>
            </div>
          )}
          {isCustomer && job.status === "completed" && job.rating == null && (
            <div className="mt-4">
              <h2 className="font-extrabold">Rate your fundi</h2>
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setRating(n)} aria-label={`${n} stars`}>
                    <Star
                      className={`h-7 w-7 ${n <= rating ? "fill-primary text-primary" : "text-border"}`}
                    />
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                placeholder="Leave a review (optional)"
                className="mt-2 w-full rounded-xl border border-input p-3"
                value={review}
                onChange={(e) => setReview(e.target.value)}
              />
              {review.trim() && (
                <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={reviewPublic}
                    onChange={(e) => setReviewPublic(e.target.checked)}
                  />{" "}
                  Publish my written review publicly
                </label>
              )}
              <button
                onClick={() =>
                  update({
                    rating,
                    review,
                    review_public: review.trim().length > 0 && reviewPublic,
                  })
                }
                className="mt-2 rounded-xl bg-primary px-5 py-2.5 font-bold text-primary-foreground"
              >
                Submit review
              </button>
            </div>
          )}
          {job.rating != null && (
            <p className="flex items-center gap-1 font-semibold">
              <Star className="h-4 w-4 fill-primary text-primary" /> Rated {job.rating}/5{" "}
              {job.review && `— “${job.review}”`}
            </p>
          )}
          {(isCustomer || isArtisan) && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Report a problem or safety concern
              </summary>
              <select
                value={reportType}
                onChange={(event) => setReportType(event.target.value as typeof reportType)}
                className="mt-2 w-full rounded-xl border border-input bg-card p-3"
              >
                <option value="job_issue">Job or booking issue</option>
                <option value="service_quality">Service quality</option>
                <option value="safety">Safety concern</option>
              </select>
              {job.artisan_id && (
                <label className="mt-2 block text-xs text-muted-foreground">
                  Report participant (optional)
                  <select
                    value={reportedUserId}
                    onChange={(event) => setReportedUserId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-input bg-card p-3 text-sm text-foreground"
                  >
                    <option value="">Report the job, not a participant</option>
                    <option value={isCustomer ? job.artisan_id : job.customer_id}>
                      {isCustomer
                        ? people?.artisanProfile?.full_name || "Fundi"
                        : people?.customer?.full_name || "Customer"}
                    </option>
                  </select>
                </label>
              )}
              <textarea
                rows={3}
                maxLength={2000}
                className="mt-2 w-full rounded-xl border border-input p-3"
                placeholder="Tell our team what happened."
                value={dispute}
                onChange={(e) => setDispute(e.target.value)}
              />
              <button
                onClick={async () => {
                  if (!dispute.trim() || submittingReport) return;
                  setSubmittingReport(true);
                  try {
                    const { error } = await supabase.from("disputes").insert({
                      job_id: id,
                      raised_by: user!.id,
                      reason: dispute.trim(),
                      report_type: reportType,
                      reported_user_id: reportedUserId || null,
                    });
                    if (error) toast.error(error.message);
                    else {
                      toast.success("Our team will review your report.");
                      setDispute("");
                      setReportedUserId("");
                    }
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Your report could not be submitted.",
                    );
                  } finally {
                    setSubmittingReport(false);
                  }
                }}
                disabled={!dispute.trim() || submittingReport}
                className="mt-2 rounded-xl bg-secondary px-4 py-2 font-bold text-secondary-foreground disabled:opacity-50"
              >
                {submittingReport ? "Submitting…" : "Submit report"}
              </button>
            </details>
          )}
        </div>
      </div>

      <div className={`${card} flex h-[560px] flex-col`}>
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <p className="font-bold">
              {other?.full_name || (job.artisan_id ? "Fundi" : "Waiting for a fundi")}
            </p>
            <p className="text-xs text-muted-foreground">
              {isArtisan
                ? "Customer"
                : a
                  ? `★ ${Number(a.rating).toFixed(1)}${a.verified ? " · Verified" : ""}`
                  : ""}
              {etaMin != null && ` · arriving in ~${etaMin} min`}
            </p>
          </div>
          {other?.phone && (
            <a
              href={`tel:${other.phone ?? ""}`}
              className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground"
              aria-label="Call"
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto py-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.sender_id === user?.id ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {m.body}
            </div>
          ))}
          {messagesError && (
            <p role="alert" className="text-center text-sm text-destructive">
              Messages could not be loaded.{" "}
              <button onClick={() => void retryMessages()} className="font-bold underline">
                Retry
              </button>
            </p>
          )}
          {!messagesError && messages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground">No messages yet</p>
          )}
          <div ref={chatEnd} />
        </div>
        {job.artisan_id && (isCustomer || isArtisan) && (
          <form onSubmit={send} className="flex gap-2 border-t border-border pt-3">
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Message…"
              className="min-w-0 flex-1 rounded-full border border-input px-4 py-2 outline-none focus:border-primary"
            />
            <button
              disabled={sending || !msg.trim()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
