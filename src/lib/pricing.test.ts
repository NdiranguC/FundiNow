import { describe, it, expect } from "vitest";
import { estimatePrice, artisanEarnings, matchArtisans } from "./pricing";

describe("pricing", () => {
  it("instant jobs get 25% surge", () => {
    expect(estimatePrice("Plumbing", "scheduled")).toBe(1500);
    expect(estimatePrice("Plumbing", "instant")).toBe(1900);
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
