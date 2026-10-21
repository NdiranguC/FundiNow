import { describe, expect, it } from "vitest";
import { canReviewJob } from "./reviews";
describe("genuine customer reviews", () => {
  it("allows the customer to review a completed job", () => {
    expect(canReviewJob({ status: "completed", rating: null }, "customer", "customer")).toBe(true);
    expect(canReviewJob({ status: "in_progress", rating: null }, "customer", "customer")).toBe(false);
  });
  it("does not allow a fundi or signed-out visitor to submit the customer review", () => {
    expect(canReviewJob({ status: "completed", rating: null }, "customer", "fundi")).toBe(false);
    expect(canReviewJob({ status: "completed", rating: null }, "customer", undefined)).toBe(false);
  });
  it("prevents a second review", () => {
    expect(canReviewJob({ status: "completed", rating: 5 }, "customer", "customer")).toBe(false);
  });
});