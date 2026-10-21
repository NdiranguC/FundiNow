import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { LocationSearch } from "@/components/LocationSearch";
import { GoogleMap } from "@/components/GoogleMap";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Zap, Droplets, Hammer, BrickWall, Paintbrush, HardHat, MapPin, ShieldCheck, Star, ArrowRight } from "lucide-react";
import hero from "@/assets/hero-fundi.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FundiNow — Find Skilled Fundis Near You" },
      { name: "description", content: "Request verified electricians, plumbers, carpenters, and other fundis near you." },
      { property: "og:title", content: "FundiNow — Trusted Fundis Near You" },
      { property: "og:description", content: "On-demand verified artisans across Kenya. Request, match, done." },
    ],
  }),
  component: Index,
});

const services = [
  { name: "Electrical", icon: Zap },
  { name: "Plumbing", icon: Droplets },
  { name: "Carpentry", icon: Hammer },
  { name: "Masonry", icon: BrickWall },
  { name: "Painting", icon: Paintbrush },
  { name: "General labour", icon: HardHat },
];

const steps = [
  { t: "Request", d: "Describe the job, add photos, choose now or later." },
  { t: "Choose", d: "Browse available verified fundis and send your request." },
  { t: "Get it done", d: "Follow job updates and message your fundi. Payments are coming later." },
];

function Index() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [address, setAddress] = useState("");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const { data: reviews = [], error: reviewsError } = useQuery({
    queryKey: ["customer-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_reviews");
      if (error) throw error;
      return data;
    },
  });
  const startRequest = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (user) {
      nav({ to: "/request", search: { address } });
    } else {
      nav({ to: "/auth" });
    }
  };
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <AppHeader />

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 md:grid-cols-2 md:py-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">
            <ShieldCheck className="h-4 w-4" /> A marketplace for verified fundis
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
            Find trusted fundis <span className="text-primary">near you</span>
          </h1>
          <p className="mt-4 max-w-md text-lg text-muted-foreground">Request electricians, plumbers, carpenters and more for your home or business.</p>
          <form id="request" className="mt-8 rounded-2xl bg-card p-3 shadow-soft" onSubmit={startRequest}>
            <div className="flex flex-col gap-2 sm:flex-row">
              {user ? (
                <LocationSearch value={address} onChange={setAddress} onPick={(p) => { setAddress(p.address); setPos({ lat: p.lat, lng: p.lng }); }} placeholder="Where do you need a fundi?" />
              ) : (
                <label className="flex flex-1 items-center gap-2 rounded-xl bg-muted px-4 py-3">
                  <MapPin className="h-5 w-5 text-primary" />
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter your location" className="w-full bg-transparent outline-none" />
                </label>
              )}
              <button className="flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-bold text-primary-foreground hover:bg-primary-deep">
                Get Help Now <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {!user && <p className="px-2 pt-2 text-xs text-muted-foreground">Sign in to see live location suggestions.</p>}
          </form>
          {hydrated && (
            <div className="mt-4">
              <GoogleMap markers={pos ? [{ lat: pos.lat, lng: pos.lng, label: address }] : []} center={pos ?? undefined} zoom={pos ? 15 : 12} className="h-56" />
            </div>
          )}
        </div>
        <div className="relative">
          <img src={hero} width={1024} height={1152} alt="A tradesperson at work" className="aspect-[4/5] w-full rounded-3xl object-cover shadow-soft" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="text-3xl font-extrabold tracking-tight">What do you need help with?</h2>
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {services.map(({ name, icon: Icon }) => (
            <Link key={name} to="/request" search={{ category: name }} className="group rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-1 hover:border-primary hover:shadow-soft">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent text-accent-foreground group-hover:bg-primary group-hover:text-primary-foreground"><Icon className="h-6 w-6" /></div>
              <p className="mt-4 font-bold">{name}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-secondary py-16 text-secondary-foreground">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-3xl font-extrabold tracking-tight">How it works</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.t}>
                <div className="grid h-10 w-10 place-items-center rounded-full bg-primary font-extrabold text-primary-foreground">{i + 1}</div>
                <h3 className="mt-4 text-xl font-bold">{s.t}</h3>
                <p className="mt-2 opacity-70">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-extrabold tracking-tight">Customer reviews</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {reviewsError && <p role="alert" className="rounded-2xl bg-destructive/10 p-8 text-center text-destructive md:col-span-3">Customer reviews could not be loaded.</p>}
          {!reviewsError && reviews.length === 0 && (
            <p className="rounded-2xl bg-card p-8 text-center text-muted-foreground md:col-span-3">Real customer reviews will appear here as jobs are completed and rated.</p>
          )}
          {reviews.map((r) => (
            <figure key={r.id} className="rounded-2xl bg-card p-6 shadow-soft">
              <div className="flex gap-0.5">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < r.rating ? "fill-primary text-primary" : "text-border"}`} />)}</div>
              <blockquote className="mt-3">“{r.review}”</blockquote>
              <figcaption className="mt-4 text-sm font-bold">{r.category} <span className="font-normal text-muted-foreground">· verified customer</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-primary p-10 text-primary-foreground md:flex-row md:items-center">
          <div><h2 className="text-3xl font-extrabold">Need a fundi?</h2><p className="mt-2 opacity-90">Describe the job and send a request to verified fundis.</p></div>
          <Link to="/request" className="rounded-full bg-secondary px-7 py-3.5 font-bold text-secondary-foreground">Get Help Now</Link>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">© 2026 FundiNow · Nairobi, Kenya</footer>
    </div>
  );
}
