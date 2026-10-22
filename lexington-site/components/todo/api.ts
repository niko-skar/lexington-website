// Talking to the site app's own API from the phone: one place for the "no signal" and error wording.

export async function send<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("No signal: that didn't save. Try again when you have data."), { status: 0 });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "That didn't save. Try again."), { status: response.status });
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : "That didn't save. Try again.");

/** "Mon 21 Oct, 10:42" */
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "Today", "Yesterday", "Monday 20 Oct" */
export function dayName(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

/**
 * Keeps a page fresh while it's open: often while someone is using it, now and then while it just
 * sits there, at once when it comes back to the front or the signal returns; never in the background.
 */
export function startPolling(refresh: () => Promise<void>, busyMs: number, idleMs: number) {
  let lastActive = Date.now();
  const active = () => {
    lastActive = Date.now();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const loop = async () => {
    if (stopped) return;
    if (document.visibilityState === "visible") await refresh();
    if (stopped) return;
    const busy = Date.now() - lastActive < 180_000;
    clearTimeout(timer);
    timer = setTimeout(loop, document.visibilityState === "visible" && busy ? busyMs : idleMs);
  };
  const wake = () => {
    if (document.visibilityState !== "visible") return;
    lastActive = Date.now();
    clearTimeout(timer);
    void loop();
  };
  timer = setTimeout(loop, busyMs);
  window.addEventListener("pointerdown", active, { passive: true });
  window.addEventListener("keydown", active);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  return () => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener("pointerdown", active);
    window.removeEventListener("keydown", active);
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
  };
}
