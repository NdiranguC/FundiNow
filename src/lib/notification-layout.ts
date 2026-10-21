import type { CSSProperties } from "react";

export function getNotificationsPanelPosition(
  anchor: Pick<DOMRect, "bottom" | "right">,
  viewportWidth: number,
  viewportHeight: number,
): CSSProperties {
  const width = Math.min(352, viewportWidth - 32);
  const isMobile = viewportWidth <= 640;

  return {
    position: "fixed",
    top: anchor.bottom + 8,
    left: isMobile
      ? viewportWidth / 2
      : Math.max(16, Math.min(anchor.right - width, viewportWidth - width - 16)),
    width,
    maxHeight: Math.max(160, Math.min(448, viewportHeight - anchor.bottom - 24)),
    transform: isMobile ? "translateX(-50%)" : undefined,
  };
}
