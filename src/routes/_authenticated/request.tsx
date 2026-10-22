import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Crosshair, ShieldCheck, Star, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  CATEGORIES,
  formatKES,
  isValidCustomerJobPrice,
  matchArtisans,
  MIN_JOB_PRICE,
  type Category,
} from "@/lib/pricing";
import { LocationSearch } from "@/components/LocationSearch";
import { GoogleMap } from "@/components/GoogleMap";
import { reverseGeocode } from "@/lib/places.functions";
import { useServerFn } from "@tanstack/react-start";

type Search = { category?: string | undefined; address?: string | undefined };

export const Route = createFileRoute("/_authenticated/request")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    category: s["category"] as string | undefined,
    address: s["address"] as string | undefined,
  }),
  head: () => ({ meta: [{ title: "Request a fundi — FundiNow" }] }),
  component: RequestPage,
});

const input =
  "w-full rounded-xl border border-input bg-card px-4 py-3 outline-none focus:border-primary";

function RequestPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const search = Route.useSearch();
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<Category>(
    (CATEGORIES as readonly string[]).includes(search.category ?? "")
      ? (search.category as Category)
      : "Electrical",
  );
  const [description, setDescription] = useState("");
  const [priceInput, setPriceInput] = useState(String(MIN_JOB_PRICE));
  const [files, setFiles] = useState<File[]>([]);
  const [urgency, setUrgency] = useState<"instant" | "scheduled">("instant");
  const [when, setWhen] = useState("");
  const [address, setAddress] = useState(search.address ?? "");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const price = Number(priceInput);
  const validPrice = isValidCustomerJobPrice(price);

  const { data: artisans = [], error: artisansError } = useQuery({
    queryKey: ["artisans-online", category],
    queryFn: async () => {
      const { data: a, error } = await supabase
        .from("artisans")
        .select("user_id,category,verified,is_online,last_active_at,lat,lng,rating,rating_count")
        .eq("category", category)
        .eq("is_online", true)
        .eq("verified", true)
        .gte("last_active_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
      if (error) throw error;
      const ids = (a ?? []).map((x) => x.user_id);
      const { data: p, error: profileError } = ids.length
        ? await supabase.from("profiles").select("id, full_name").in("id", ids)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const { data: stats, error: statsError } = ids.length
        ? await supabase.rpc("artisan_completed_job_counts", { _artisan_ids: ids })
        : { data: [], error: null };
      if (statsError) throw statsError;
      return (a ?? []).map((x) => ({
        ...x,
        rating: Number(x.rating),
        name: p?.find((y) => y.id === x.user_id)?.full_name || "Fundi",
        completed_jobs: stats?.find((stat) => stat.artisan_id === x.user_id)?.completed_jobs ?? 0,
      }));
    },
  });
  const matches = matchArtisans(artisans, category, pos);

  const reverse = useServerFn(reverseGeocode);

  async function nameSpot(lat: number, lng: number) {
    setPos({ lat, lng });
    try {
      const { address: a } = await reverse({ data: { lat, lng } });
      if (a) setAddress(a);
    } catch {
      toast.error(
        "Location pin saved. Enter the address manually because address lookup is unavailable.",
      );
    }
  }

  function locate() {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        nameSpot(p.coords.latitude, p.coords.longitude);
      },
      () => toast.error("Couldn't get your location — type it instead"),
    );
  }

  async function submit(artisanId: string | null) {
    if (!user) return undefined;
    if (!validPrice) {
      toast.error(`Enter a whole-number offer of at least ${formatKES(MIN_JOB_PRICE)}.`);
      return undefined;
    }
    setBusy(true);
    const photos: string[] = [];
    try {
      for (const file of files) {
        const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;
        const { error } = await supabase.storage.from("job-media").upload(path, file);
        if (error) throw error;
        photos.push(path);
      }
      const { data, error } = await supabase
        .from("jobs")
        .insert({
          customer_id: user.id,
          artisan_id: artisanId,
          category,
          description,
          address,
          lat: pos?.lat ?? null,
          lng: pos?.lng ?? null,
          urgency,
          scheduled_at: urgency === "scheduled" && when ? new Date(when).toISOString() : null,
          price_estimate: price,
          photos,
        })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Request sent!");
      nav({ to: "/jobs/$id", params: { id: data.id } });
    } catch (error) {
      if (photos.length) {
        const { error: cleanupError } = await supabase.storage.from("job-media").remove(photos);
        if (cleanupError)
          toast.error(`Uploaded photos could not be cleaned up: ${cleanupError.message}`);
      }
      toast.error(error instanceof Error ? error.message : "The job request could not be sent");
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex gap-2">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full ${step >= n ? "bg-primary" : "bg-border"}`}
          />
        ))}
      </div>
      <div className="rounded-3xl bg-card p-6 shadow-soft">
        {step === 1 && (
          <>
            <h1 className="text-2xl font-extrabold">What do you need?</h1>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`rounded-xl border p-3 text-sm font-bold ${category === c ? "border-primary bg-accent text-accent-foreground" : "border-border"}`}
                >
                  {c}
                </button>
              ))}
            </div>
            <textarea
              required
              rows={4}
              placeholder="Describe the job, e.g. kitchen sink is leaking under the cabinet"
              className={`${input} mt-4`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              <Upload className="h-4 w-4 text-primary" />{" "}
              {files.length
                ? `${files.length} file(s) attached`
                : "Add photos or videos (optional)"}
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                className="hidden"
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? []);
                  const allowed = selected.every((file) =>
                    ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"].includes(
                      file.type,
                    ),
                  );
                  if (
                    selected.length > 5 ||
                    selected.some((file) => file.size > 10 * 1024 * 1024) ||
                    !allowed
                  ) {
                    toast.error(
                      "Choose up to 5 JPG, PNG, WebP, MP4 or WebM files under 10 MB each.",
                    );
                    e.target.value = "";
                    return;
                  }
                  setFiles(selected);
                }}
              />
            </label>
            <button
              disabled={description.trim().length < 5}
              onClick={() => setStep(2)}
              className="mt-5 w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50"
            >
              Continue
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h1 className="text-2xl font-extrabold">Where & when?</h1>
            <div className="mt-5 flex gap-2">
              <LocationSearch
                value={address}
                onChange={setAddress}
                onPick={(p) => {
                  setAddress(p.address);
                  setPos({ lat: p.lat, lng: p.lng });
                }}
                placeholder="Search an address or landmark"
              />
              <button
                onClick={locate}
                className="rounded-xl bg-accent px-4 text-accent-foreground"
                aria-label="Use my location"
              >
                <Crosshair className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3">
              <GoogleMap
                markers={
                  pos ? [{ lat: pos.lat, lng: pos.lng, label: address || "Job location" }] : []
                }
                center={pos ?? undefined}
                zoom={15}
                className="h-56"
                draggable
                onPick={(lat, lng) => nameSpot(lat, lng)}
              />
              <p className="mt-1 text-xs text-primary">
                {pos
                  ? "Pin placed — tap the map or drag the pin to adjust it"
                  : "Enter an address to continue. Add a map pin for distance-based matching."}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["instant", "scheduled"] as const).map((u) => (
                <button
                  key={u}
                  onClick={() => setUrgency(u)}
                  className={`rounded-xl border p-4 text-left ${urgency === u ? "border-primary bg-accent" : "border-border"}`}
                >
                  <p className="font-bold">{u === "instant" ? "Now" : "Schedule"}</p>
                  <p className="text-xs text-muted-foreground">
                    {u === "instant" ? "Request service now" : "Pick a time"}
                  </p>
                </button>
              ))}
            </div>
            {urgency === "scheduled" && (
              <input
                type="datetime-local"
                className={`${input} mt-3`}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            )}
            <div className="mt-5 rounded-xl bg-muted p-4">
              <label htmlFor="job-price" className="text-sm font-bold">
                Your offer (KES)
              </label>
              <input
                id="job-price"
                type="number"
                min={MIN_JOB_PRICE}
                max={2_147_483_647}
                step={1}
                required
                className={`${input} mt-2`}
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
                aria-describedby="job-price-hint"
              />
              <p id="job-price-hint" className="mt-2 text-xs text-muted-foreground">
                Set the amount you’re offering. Minimum {formatKES(MIN_JOB_PRICE)}.
              </p>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setStep(1)}
                className="rounded-xl border border-border px-5 py-3 font-semibold"
              >
                Back
              </button>
              <button
                disabled={!address || (urgency === "scheduled" && !when) || !validPrice}
                onClick={() => setStep(3)}
                className="flex-1 rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50"
              >
                Find fundis
              </button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h1 className="text-2xl font-extrabold">Choose your fundi</h1>
            <p className="text-sm text-muted-foreground">
              {matches.length} verified {category.toLowerCase()} fundis{" "}
              {pos ? "near you" : "available"}
            </p>
            {artisansError && (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
              >
                Available fundis could not be loaded. You can still request the job for a matching
                fundi to accept.
              </p>
            )}
            <button
              onClick={() => void submit(null)}
              className="mt-5 w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground shadow-glow disabled:opacity-50"
              disabled={busy || !validPrice}
            >
              Send to verified fundis online · {formatKES(price)}
            </button>
            <div className="mt-4 space-y-2">
              {matches.map((a) => (
                <div
                  key={a.user_id}
                  className="flex items-center justify-between rounded-xl border border-border p-4"
                >
                  <div>
                    <p className="flex items-center gap-1 font-bold">
                      {a.name} {a.verified && <ShieldCheck className="h-4 w-4 text-primary" />}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Star className="h-3 w-3 fill-primary text-primary" /> {a.rating.toFixed(1)} ·{" "}
                      {a.rating_count} reviews · {a.completed_jobs} completed jobs
                      {a.km != null && ` · ${a.km.toFixed(1)} km`}
                    </p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => void submit(a.user_id)}
                    className="rounded-full bg-secondary px-4 py-2 text-sm font-bold text-secondary-foreground"
                  >
                    Request
                  </button>
                </div>
              ))}
              {matches.length === 0 && (
                <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                  No fundis are active right now. You can still submit your request; eligible fundis
                  in this category will be notified when they come online.
                </p>
              )}
            </div>
            <button
              onClick={() => setStep(2)}
              className="mt-4 text-sm font-semibold text-muted-foreground"
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
