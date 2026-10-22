import { describe, it, expect } from "vitest";
import { artisanEarnings, isValidCustomerJobPrice, matchArtisans, MIN_JOB_PRICE } from "./pricing";

describe("pricing", () => {
  it("requires customer-set job prices to meet the KES 1,500 minimum", () => {
    expect(MIN_JOB_PRICE).toBe(1500);
    expect(isValidCustomerJobPrice(1500)).toBe(true);
    expect(isValidCustomerJobPrice(2750)).toBe(true);
    expect(isValidCustomerJobPrice(1499)).toBe(false);
    expect(isValidCustomerJobPrice(1500.5)).toBe(false);
    expect(isValidCustomerJobPrice(Number.MAX_SAFE_INTEGER)).toBe(false);
  });
  it("artisan earns price minus commission", () => {
    expect(artisanEarnings(2000, 15)).toBe(1700);
  });
  it("matching keeps only online artisans of the category, max 5", () => {
    const mk = (i: number, online = true, cat = "Electrical") => ({
      user_id: String(i),
      rating: 4,
      is_online: online,
      category: cat,
      lat: -1.28 + i * 0.01,
      lng: 36.8,
    });
    const list = [mk(1, false), mk(2, true, "Plumbing"), ...[3, 4, 5, 6, 7, 8].map((i) => mk(i))];
    const res = matchArtisans(list, "Electrical", { lat: -1.28, lng: 36.8 });
    expect(res.map((r) => r.user_id)).toEqual(["3", "4", "5", "6", "7"]);
  });
  it("matching excludes artisans whose online heartbeat is stale", () => {
    const active = {
      user_id: "active",
      rating: 5,
      is_online: true,
      category: "Electrical",
      lat: null,
      lng: null,
      last_active_at: new Date().toISOString(),
    };
    const stale = {
      ...active,
      user_id: "stale",
      last_active_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    };

    expect(
      matchArtisans([active, stale], "Electrical", null).map((artisan) => artisan.user_id),
    ).toEqual(["active"]);
  });
});
