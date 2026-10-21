import { describe, expect, it } from "vitest";
import { getNotificationsPanelPosition } from "@/lib/notification-layout";

describe("notification panel positioning", () => {
  it("centers the panel in the viewport on phone-sized screens", () => {
    const position = getNotificationsPanelPosition({ bottom: 64, right: 370 }, 390, 844);

    expect(position).toMatchObject({
      left: 195,
      top: 72,
      width: 352,
      transform: "translateX(-50%)",
    });
  });

  it("keeps the panel aligned to the bell on wider screens", () => {
    const position = getNotificationsPanelPosition({ bottom: 64, right: 900 }, 1024, 768);

    expect(position).toMatchObject({
      left: 548,
      top: 72,
      width: 352,
      transform: undefined,
    });
  });
});
