import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";

vi.mock("sonner", () => ({
  Toaster: ({ position, style }: { position: string; style: React.CSSProperties }) => (
    <div data-testid="toaster" data-position={position} style={style} />
  ),
}));

describe("Toaster", () => {
  it("centers notifications and keeps them within narrow viewports", () => {
    render(<Toaster />);
    const toaster = screen.getByTestId("toaster");

    expect(toaster).toHaveAttribute("data-position", "top-center");
    expect(toaster.style.getPropertyValue("--width")).toBe("min(calc(100vw - 2rem), 356px)");
    expect(toaster.style.getPropertyValue("--offset-top")).toBe(
      "max(16px, env(safe-area-inset-top))",
    );
  });
});
