export const CATEGORIES = [
  "Electrical",
  "Plumbing",
  "Carpentry",
  "Masonry",
  "Painting",
  "General labour",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const MIN_JOB_PRICE = 1500;

export function isValidCustomerJobPrice(price: number) {
  return Number.isSafeInteger(price) && price >= MIN_JOB_PRICE && price <= 2_147_483_647;
}

export function artisanEarnings(price: number, commissionPct: number) {
  return Math.round(price * (1 - commissionPct / 100));
}

export function formatKES(n: number) {
  return `KES ${n.toLocaleString("en-KE")}`;
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Candidate = {
  user_id: string;
  rating: number;
  is_online: boolean;
  category: string;
  lat: number | null;
  lng: number | null;
  last_active_at?: string | null;
};
export const ARTISAN_ACTIVE_WINDOW_MS = 10 * 60 * 1000;

/** Nearest online artisans in the category, then by rating. Top 5. */
export function matchArtisans<T extends Candidate>(
  list: T[],
  category: string,
  at: { lat: number; lng: number } | null,
) {
  return list
    .filter(
      (a) =>
        a.is_online &&
        a.category === category &&
        (a.last_active_at === undefined ||
          (a.last_active_at !== null &&
            Number.isFinite(Date.parse(a.last_active_at)) &&
            Date.now() - Date.parse(a.last_active_at) <= ARTISAN_ACTIVE_WINDOW_MS)),
    )
    .map((a) => ({
      ...a,
      km: at && a.lat != null && a.lng != null ? distanceKm(at, { lat: a.lat, lng: a.lng }) : null,
    }))
    .sort((x, y) => (x.km ?? 9999) - (y.km ?? 9999) || Number(y.rating) - Number(x.rating))
    .slice(0, 5);
}
