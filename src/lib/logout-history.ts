let exitOnNextBack = false;
let fallbackTimer: number | undefined;

export function armLogoutBackExit(): void {
  exitOnNextBack = true;
}

export function cancelLogoutBackExit(): void {
  exitOnNextBack = false;
}

export function installLogoutBackExit(): () => void {
  const clearFallback = () => {
    if (fallbackTimer !== undefined) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
  };

  const onPopState = () => {
    if (!exitOnNextBack) return;
    exitOnNextBack = false;

    const index = window.history.state?.__TSR_index;
    const backToBeforeApp = Number.isSafeInteger(index) && index >= 0 ? -(index + 1) : -1;
    window.history.go(backToBeforeApp);

    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = undefined;
      window.location.replace("/auth");
    }, 500);
  };

  window.addEventListener("popstate", onPopState);
  window.addEventListener("pagehide", clearFallback);
  return () => {
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("pagehide", clearFallback);
    clearFallback();
  };
}
