// Keeps the phone's screen on while something needs the app open: pre-pour photos going up, the app's camera. A screen
// that goes dark puts the app to sleep and stops them. A phone that can't do it (or won't now: low battery) is left
// alone. Each reason holds it until it lets go; the phone lets go by itself when the app is hidden, so it's asked again
// when the app is back.

const reasons = new Set<string>();
let lock: WakeLockSentinel | null = null;
let asking = false;
let watching = false;

export function keepAwake(reason: string, on: boolean) {
  if (on === reasons.has(reason)) return;
  if (on) reasons.add(reason);
  else reasons.delete(reason);
  void apply();
}

async function apply() {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator) || asking) return;
  if (!watching) {
    watching = true;
    document.addEventListener("visibilitychange", () => void apply());
  }
  if (reasons.size && !lock && document.visibilityState === "visible") {
    asking = true;
    try {
      const got = await navigator.wakeLock.request("screen");
      got.addEventListener("release", () => {
        if (lock === got) lock = null;
      });
      lock = got;
    } catch {
      // Not allowed now: nothing to do.
    } finally {
      asking = false;
    }
    // Let go of meanwhile.
    if (!reasons.size) void apply();
  } else if (!reasons.size && lock) {
    const was = lock;
    lock = null;
    await was.release().catch(() => {});
  }
}
