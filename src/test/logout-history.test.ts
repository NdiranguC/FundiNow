import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armLogoutBackExit,
  cancelLogoutBackExit,
  installLogoutBackExit,
} from "@/lib/logout-history";

describe("logout back navigation", () => {
  afterEach(() => {
    cancelLogoutBackExit();
    vi.restoreAllMocks();
  });

  it("skips the app's remaining history entries after sign-out", () => {
    Object.defineProperty(window.history, "state", {
      configurable: true,
      value: { __TSR_index: 2 },
    });
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    const cleanup = installLogoutBackExit();
    armLogoutBackExit();

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(go).toHaveBeenCalledWith(-3);
    cleanup();
  });

  it("does not alter back navigation unless sign-out armed it", () => {
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    const cleanup = installLogoutBackExit();

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(go).not.toHaveBeenCalled();
    cleanup();
  });
});
