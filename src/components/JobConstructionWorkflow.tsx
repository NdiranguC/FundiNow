import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatKES } from "@/lib/pricing";
import type { Json, Tables } from "@/integrations/supabase/types";

type Job = Tables<"jobs">;
type Quote = Tables<"job_quotes">;
type JobUpdate = Tables<"job_updates">;
type Snag = Tables<"job_snags">;
type QuoteItem = {
  type: "labour" | "materials" | "transport" | "other";
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
};
type QuoteDraftItem = Omit<QuoteItem, "quantity" | "unit_price"> & {
  quantity: string;
  unit_price: string;
};

const blankItem = (): QuoteDraftItem => ({
  type: "labour",
  description: "",
  quantity: "1",
  unit: "job",
  unit_price: "",
});
const card = "rounded-3xl bg-card p-6 shadow-soft";

function parseQuoteItems(value: Json): QuoteItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Json & QuoteItem => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return (
      ["labour", "materials", "transport", "other"].includes(String(item["type"])) &&
      typeof item["description"] === "string" &&
      typeof item["quantity"] === "number" &&
      typeof item["unit"] === "string" &&
      typeof item["unit_price"] === "number"
    );
  });
}

function QuotePdf({
  job,
  quote,
  customerName,
  artisanName,
}: {
  job: Job;
  quote: Quote;
  customerName: string;
  artisanName: string;
}) {
  const download = async () => {
    if (quote.decision_approved !== true) return;
    let Pdf: typeof import("jspdf").jsPDF;
    try {
      Pdf = (await import("jspdf")).jsPDF;
    } catch (error) {
      console.error("Could not load the agreement PDF generator", error);
      toast.error("The agreement PDF could not be prepared. Please try again.");
      return;
    }
    const pdf = new Pdf();
    const items = parseQuoteItems(quote.items);
    let y = 20;
    const line = (text: string, indent = 14) => {
      const wrapped = pdf.splitTextToSize(text, 180 - indent);
      if (y + wrapped.length * 6 > 278) {
        pdf.addPage();
        y = 20;
      }
      pdf.text(wrapped, indent, y);
      y += wrapped.length * 6;
    };

    pdf.setFontSize(18);
    pdf.setFont("helvetica", "bold");
    line("FundiNow — Job Agreement Summary");
    y += 2;
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    line(`Job: ${job.description}`);
    line(`Category: ${job.category}`);
    line(`Location: ${job.address}`);
    line(`Customer: ${customerName}`);
    line(`Fundi: ${artisanName}`);
    line(`Quote version: ${quote.version}`);
    line(
      `Approved: ${quote.decided_at ? new Date(quote.decided_at).toLocaleString() : "Approval recorded"}`,
    );
    if (quote.status === "superseded")
      line("This approved version was later superseded by a newer quote.");
    y += 3;
    pdf.setFont("helvetica", "bold");
    line("Agreed scope");
    pdf.setFont("helvetica", "normal");
    line(quote.scope);
    y += 3;
    pdf.setFont("helvetica", "bold");
    line("Itemized estimate");
    pdf.setFont("helvetica", "normal");
    for (const item of items) {
      line(
        `${item.type.toUpperCase()} — ${item.description}: ${item.quantity} ${item.unit} × ${formatKES(item.unit_price)} = ${formatKES(item.quantity * item.unit_price)}`,
      );
    }
    y += 2;
    pdf.setFont("helvetica", "bold");
    line(`Agreed quote total: ${formatKES(quote.total)}`);
    y += 4;
    pdf.setFont("helvetica", "normal");
    line(
      "This document records the scope and quote approved by the customer in FundiNow. Changes require a new quote and customer approval. It is not independent legal advice, a guarantee of workmanship, or proof of payment. The platform's call-out estimate and any payment status are separate.",
    );
    pdf.save(`FundiNow-job-agreement-${job.id.slice(0, 8)}-v${quote.version}.pdf`);
  };

  return (
    <button
      onClick={download}
      className="rounded-xl border border-border px-3 py-2 text-sm font-semibold"
    >
      Download agreement PDF
    </button>
  );
}

export function JobConstructionWorkflow({
  job,
  isArtisan,
  isCustomer,
  customerName,
  artisanName,
}: {
  job: Job;
  isArtisan: boolean;
  isCustomer: boolean;
  customerName: string;
  artisanName: string;
}) {
  const qc = useQueryClient();
  const [scope, setScope] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [items, setItems] = useState<QuoteDraftItem[]>([blankItem()]);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [snagDescription, setSnagDescription] = useState("");
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [busySnag, setBusySnag] = useState(false);
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState<File | null>(null);
  const [postingUpdate, setPostingUpdate] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  const quotesQuery = useQuery({
    queryKey: ["job-quotes", job.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_quotes")
        .select("*")
        .eq("job_id", job.id)
        .order("version", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const updatesQuery = useQuery({
    queryKey: ["job-updates", job.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_updates")
        .select("id,job_id,author_id,kind,body,media_path,created_at")
        .eq("job_id", job.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  const snagsQuery = useQuery({
    queryKey: ["job-snags", job.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_snags")
        .select(
          "id,job_id,description,status,created_by,created_at,resolution,resolved_by,resolved_at",
        )
        .eq("job_id", job.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const mediaPaths = (updatesQuery.data ?? []).flatMap((update) =>
    update.media_path ? [update.media_path] : [],
  );
  const mediaQuery = useQuery({
    queryKey: ["job-update-media", job.id, mediaPaths],
    enabled: mediaPaths.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("job-media")
        .createSignedUrls(mediaPaths, 3600);
      if (error) throw error;
      return Object.fromEntries(
        data.flatMap((entry) => (entry.signedUrl ? [[entry.path, entry.signedUrl]] : [])),
      );
    },
  });

  useEffect(() => {
    const setConnection = () => setOnline(navigator.onLine);
    window.addEventListener("online", setConnection);
    window.addEventListener("offline", setConnection);
    return () => {
      window.removeEventListener("online", setConnection);
      window.removeEventListener("offline", setConnection);
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`job-workflow-${job.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_quotes", filter: `job_id=eq.${job.id}` },
        () => qc.invalidateQueries({ queryKey: ["job-quotes", job.id] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_updates", filter: `job_id=eq.${job.id}` },
        () => qc.invalidateQueries({ queryKey: ["job-updates", job.id] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_snags", filter: `job_id=eq.${job.id}` },
        () => qc.invalidateQueries({ queryKey: ["job-snags", job.id] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [job.id, qc]);

  const latestQuote = quotesQuery.data?.[0];
  const openSnags = useMemo(
    () => (snagsQuery.data ?? []).filter((snag) => snag.status === "open"),
    [snagsQuery.data],
  );
  const quoteTotal = items.reduce((sum, item) => {
    const qty = Number(item.quantity);
    const price = Number(item.unit_price);
    return sum + (Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0);
  }, 0);

  const submitQuote = async () => {
    if (quoteBusy) return;
    const cleanItems = items.map((item) => ({
      type: item.type,
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unit: item.unit.trim(),
      unit_price: Number(item.unit_price),
    }));
    if (
      scope.trim().length < 5 ||
      cleanItems.some(
        (item) =>
          item.description.length < 2 ||
          !item.unit ||
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0 ||
          !Number.isFinite(item.unit_price) ||
          item.unit_price < 0,
      )
    ) {
      toast.error("Add the work scope and complete every quote line.");
      return;
    }
    setQuoteBusy(true);
    try {
      const { error } = await supabase.rpc("submit_job_quote", {
        _job: job.id,
        _scope: scope.trim(),
        _items: cleanItems as Json,
        ...(changeReason.trim() ? { _change_reason: changeReason.trim() } : {}),
      });
      if (error) throw error;
      toast.success("Quote sent to the customer for approval.");
      setScope("");
      setChangeReason("");
      setItems([blankItem()]);
      await qc.invalidateQueries({ queryKey: ["job-quotes", job.id] });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The quote could not be submitted. Your draft is still here.",
      );
    } finally {
      setQuoteBusy(false);
    }
  };

  const decideQuote = async (quote: Quote, approve: boolean) => {
    const { error } = await supabase.rpc("decide_job_quote", {
      _quote: quote.id,
      _approve: approve,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(approve ? "Quote approved. The fundi can now start work." : "Quote declined.");
      await qc.invalidateQueries({ queryKey: ["job-quotes", job.id] });
    }
  };

  const addUpdate = async () => {
    if (postingUpdate || !note.trim()) return;
    setPostingUpdate(true);
    let uploadedPath: string | null = null;
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError ?? new Error("Sign in and retry.");
      if (evidence) {
        if (
          evidence.size > 10 * 1024 * 1024 ||
          !(evidence.type.startsWith("image/") || evidence.type === "application/pdf")
        ) {
          throw new Error("Choose an image or PDF under 10 MB.");
        }
        uploadedPath = `${userData.user.id}/${job.id}/${crypto.randomUUID()}-${evidence.name.replace(/[^\w.-]/g, "_")}`;
        const { error: uploadError } = await supabase.storage
          .from("job-media")
          .upload(uploadedPath, evidence);
        if (uploadError) throw uploadError;
      }
      const { error } = await supabase.from("job_updates").insert({
        job_id: job.id,
        author_id: userData.user.id,
        kind: uploadedPath ? "evidence" : "progress",
        body: note.trim(),
        media_path: uploadedPath,
      });
      if (error) throw error;
      setNote("");
      setEvidence(null);
      toast.success("Job update saved.");
      await qc.invalidateQueries({ queryKey: ["job-updates", job.id] });
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from("job-media")
          .remove([uploadedPath]);
        if (cleanupError)
          toast.error(
            `The update failed and its uploaded file could not be removed: ${cleanupError.message}`,
          );
      }
      toast.error(
        error instanceof Error
          ? `${error.message} Your draft is still here.`
          : "The update could not be saved. Your draft is still here.",
      );
    } finally {
      setPostingUpdate(false);
    }
  };

  const createSnag = async () => {
    if (busySnag || !snagDescription.trim()) return;
    setBusySnag(true);
    try {
      const { error } = await supabase.rpc("create_job_snag", {
        _job: job.id,
        _description: snagDescription.trim(),
      });
      if (error) throw error;
      setSnagDescription("");
      toast.success("Snag added for fundi follow-up.");
      await qc.invalidateQueries({ queryKey: ["job-snags", job.id] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The snag could not be saved.");
    } finally {
      setBusySnag(false);
    }
  };

  const resolveSnag = async (snag: Snag) => {
    if (busySnag) return;
    setBusySnag(true);
    try {
      const { error } = await supabase.rpc("resolve_job_snag", {
        _snag: snag.id,
        _resolution: resolution[snag.id]?.trim() ?? "",
      });
      if (error) throw error;
      toast.success("Snag marked resolved.");
      await qc.invalidateQueries({ queryKey: ["job-snags", job.id] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The snag could not be updated.");
    } finally {
      setBusySnag(false);
    }
  };

  const confirmHandover = async () => {
    const { error } = await supabase.rpc("confirm_job_handover", { _job: job.id });
    if (error) toast.error(error.message);
    else {
      toast.success("Handover confirmed.");
      await qc.invalidateQueries({ queryKey: ["job", job.id] });
      await qc.invalidateQueries({ queryKey: ["job-updates", job.id] });
    }
  };

  const retryQueries = () => {
    void quotesQuery.refetch();
    void updatesQuery.refetch();
    void snagsQuery.refetch();
  };
  const queriesError = quotesQuery.error || updatesQuery.error || snagsQuery.error;

  return (
    <section className="space-y-5">
      {!online && (
        <p role="status" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">
          You’re offline. Your quote and update drafts stay on this page; reconnect to submit them.
        </p>
      )}
      {queriesError && (
        <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          Job agreement details could not be loaded.{" "}
          <button onClick={retryQueries} className="font-bold underline">
            Retry
          </button>
        </p>
      )}

      <div className={card}>
        <h2 className="text-xl font-extrabold">Itemized quote & agreed scope</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The fundi’s itemized quote is separate from the platform call-out estimate shown above.
          Scope or price changes need fresh customer approval.
        </p>
        {(quotesQuery.data ?? []).map((quote) => (
          <div key={quote.id} className="mt-4 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-bold">
                  Version {quote.version} · {formatKES(quote.total)}
                </p>
                <p className="text-xs capitalize text-muted-foreground">
                  {quote.status}
                  {quote.change_reason ? ` · ${quote.change_reason}` : ""}
                </p>
              </div>
              {quote.decision_approved && (
                <QuotePdf
                  job={job}
                  quote={quote}
                  customerName={customerName}
                  artisanName={artisanName}
                />
              )}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{quote.scope}</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {parseQuoteItems(quote.items).map((item, index) => (
                <li key={`${quote.id}-${index}`}>
                  <span className="capitalize">{item.type}</span>: {item.description} ·{" "}
                  {item.quantity} {item.unit} × {formatKES(item.unit_price)}
                </li>
              ))}
            </ul>
            {quote.status === "pending" && isCustomer && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => void decideQuote(quote, false)}
                  className="rounded-xl border border-border px-4 py-2 font-semibold"
                >
                  Decline
                </button>
                <button
                  onClick={() => void decideQuote(quote, true)}
                  className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground"
                >
                  Approve quote
                </button>
              </div>
            )}
            {quote.status === "pending" && isCustomer && (
              <p className="mt-2 text-xs text-muted-foreground">
                {job.quote_required
                  ? "Work cannot start until you approve the latest quote."
                  : "Approve the latest quote before agreeing to the updated scope."}
              </p>
            )}
          </div>
        ))}
        {!quotesQuery.isPending && !quotesQuery.data?.length && (
          <p className="mt-3 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
            {job.quote_required
              ? "No itemized quote yet. The fundi will submit one for approval before starting work."
              : "No itemized quote has been recorded for this existing job. You can still agree a written quote or scope change here."}
          </p>
        )}
        {isArtisan &&
          job.status !== "pending" &&
          job.status !== "completed" &&
          job.status !== "cancelled" && (
            <div className="mt-5 space-y-3 border-t border-border pt-4">
              <h3 className="font-bold">
                {latestQuote ? "Propose a revised quote" : "Submit an itemized quote"}
              </h3>
              {latestQuote && (
                <input
                  value={changeReason}
                  onChange={(event) => setChangeReason(event.target.value)}
                  maxLength={1000}
                  placeholder="Reason for this change (optional)"
                  className="w-full rounded-xl border border-input bg-card px-3 py-2"
                />
              )}
              <textarea
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                rows={3}
                maxLength={3000}
                placeholder="Describe the work included in this quote"
                className="w-full rounded-xl border border-input p-3"
              />
              {items.map((item, index) => (
                <div key={index} className="grid gap-2 rounded-xl bg-muted p-3 sm:grid-cols-6">
                  <select
                    value={item.type}
                    onChange={(event) =>
                      setItems(
                        items.map((entry, i) =>
                          i === index
                            ? { ...entry, type: event.target.value as QuoteDraftItem["type"] }
                            : entry,
                        ),
                      )
                    }
                    className="rounded-lg border border-input bg-card px-2 py-2 sm:col-span-2"
                  >
                    <option value="labour">Labour</option>
                    <option value="materials">Materials</option>
                    <option value="transport">Transport</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    value={item.description}
                    onChange={(event) =>
                      setItems(
                        items.map((entry, i) =>
                          i === index ? { ...entry, description: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Item"
                    maxLength={200}
                    className="rounded-lg border border-input bg-card px-3 py-2 sm:col-span-4"
                  />
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={item.quantity}
                    onChange={(event) =>
                      setItems(
                        items.map((entry, i) =>
                          i === index ? { ...entry, quantity: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Quantity"
                    className="rounded-lg border border-input bg-card px-3 py-2"
                  />
                  <input
                    value={item.unit}
                    onChange={(event) =>
                      setItems(
                        items.map((entry, i) =>
                          i === index ? { ...entry, unit: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Unit (e.g. bag)"
                    maxLength={40}
                    className="rounded-lg border border-input bg-card px-3 py-2"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unit_price}
                    onChange={(event) =>
                      setItems(
                        items.map((entry, i) =>
                          i === index ? { ...entry, unit_price: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="KES per unit"
                    className="rounded-lg border border-input bg-card px-3 py-2 sm:col-span-2"
                  />
                  {items.length > 1 && (
                    <button
                      onClick={() => setItems(items.filter((_, i) => i !== index))}
                      className="rounded-lg border border-border px-3 py-2 text-sm sm:col-span-1"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  disabled={items.length >= 20}
                  onClick={() => setItems([...items, blankItem()])}
                  className="rounded-xl border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Add item
                </button>
                <p className="font-bold">Quote total: {formatKES(quoteTotal)}</p>
              </div>
              <button
                onClick={() => void submitQuote()}
                disabled={quoteBusy || !online}
                className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50"
              >
                {quoteBusy ? "Sending…" : "Send quote for approval"}
              </button>
            </div>
          )}
      </div>

      <div className={card}>
        <h2 className="text-xl font-extrabold">Job progress & evidence</h2>
        <p className="mt-1 text-xs text-muted-foreground">Showing the latest 100 updates.</p>
        {(isCustomer || isArtisan) && job.status !== "cancelled" && (
          <div className="mt-3 space-y-2">
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Add a progress note or handover detail"
              className="w-full rounded-xl border border-input p-3"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => setEvidence(event.target.files?.[0] ?? null)}
                className="min-w-0 flex-1 text-sm"
              />
              <button
                onClick={() => void addUpdate()}
                disabled={!note.trim() || postingUpdate || !online}
                className="rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50"
              >
                {postingUpdate ? "Saving…" : "Add update"}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Evidence is private to the customer, assigned fundi, and admin. Images or PDFs up to
              10 MB.
            </p>
          </div>
        )}
        {updatesQuery.data?.map((update: JobUpdate) => (
          <article key={update.id} className="mt-3 rounded-xl bg-muted p-3">
            <p className="text-xs font-semibold capitalize text-muted-foreground">
              {update.kind} · {new Date(update.created_at).toLocaleString()}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{update.body}</p>
            {update.media_path && mediaQuery.data?.[update.media_path] && (
              <a
                href={mediaQuery.data[update.media_path]}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm font-bold text-primary underline"
              >
                View attached evidence
              </a>
            )}
          </article>
        ))}
        {mediaQuery.error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Evidence links could not be loaded.{" "}
            <button onClick={() => void mediaQuery.refetch()} className="font-bold underline">
              Retry
            </button>
          </p>
        )}
      </div>

      {job.status === "completed" && (
        <div className={card}>
          <h2 className="text-xl font-extrabold">Snag follow-up & handover</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Record unfinished or defective work and its resolution. This does not change payment
            status.
          </p>
          {isCustomer && (
            <div className="mt-3 space-y-2">
              <textarea
                value={snagDescription}
                onChange={(event) => setSnagDescription(event.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="Describe an issue that needs follow-up"
                className="w-full rounded-xl border border-input p-3"
              />
              <button
                onClick={() => void createSnag()}
                disabled={!snagDescription.trim() || busySnag || !online}
                className="rounded-xl border border-border px-4 py-2 font-semibold disabled:opacity-50"
              >
                {busySnag ? "Saving…" : "Add snag"}
              </button>
            </div>
          )}
          {(snagsQuery.data ?? []).map((snag) => (
            <div key={snag.id} className="mt-3 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{snag.description}</p>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-bold ${snag.status === "open" ? "bg-amber-100 text-amber-900" : "bg-accent text-accent-foreground"}`}
                >
                  {snag.status}
                </span>
              </div>
              {snag.resolution && (
                <p className="mt-2 text-sm text-muted-foreground">Resolution: {snag.resolution}</p>
              )}
              {isArtisan && snag.status === "open" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={resolution[snag.id] ?? ""}
                    onChange={(event) =>
                      setResolution({ ...resolution, [snag.id]: event.target.value })
                    }
                    maxLength={1000}
                    placeholder="Describe how you resolved it"
                    className="min-w-0 flex-1 rounded-lg border border-input px-3 py-2"
                  />
                  <button
                    onClick={() => void resolveSnag(snag)}
                    disabled={busySnag || !online}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
                  >
                    Mark resolved
                  </button>
                </div>
              )}
            </div>
          ))}
          {isCustomer && job.customer_confirmed_at && (
            <p className="mt-3 text-sm font-semibold text-primary">
              Handover confirmed on {new Date(job.customer_confirmed_at).toLocaleString()}.
            </p>
          )}
          {isCustomer && !job.customer_confirmed_at && (
            <button
              onClick={() => void confirmHandover()}
              disabled={openSnags.length > 0 || !online}
              className="mt-4 w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50"
            >
              {openSnags.length
                ? "Resolve open snags before confirming handover"
                : "Confirm job handover"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
