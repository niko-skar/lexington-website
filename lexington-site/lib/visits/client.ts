/**
 * The browser half of the visit record (`rules.ts` has the rules and the reasons).
 *
 * It watches one visit: pages seen and left, how long, how far down, what the
 * visitor did (an enquiry, WhatsApp, a call, a unit opened), and the moments
 * that suggest something is wrong: the same thing tapped again and again (rage),
 * a tap that did nothing (dead), going straight back (quick back), a page error.
 * It sends them a few at a time to /api/visit.
 *
 * WHAT IT KEEPS: the visit's random id, the events not yet sent, and the pages
 * seen, in this page's MEMORY. Nothing in storage, no cookie. Close the tab and
 * it is gone; open the site again and it is a different visit.
 *
 * WHO IT SENDS NOTHING FOR: browsers that say Do Not Track or Global Privacy
 * Control, browsers driven by a script, pages only being prerendered, and the
 * admin, buyer-portal and Studio pages (`visitPath` refuses them).
 *
 * NEVER THROWS INTO THE UI. Watching a tap must not be able to break the tap.
 */
import {
  DEAD_TAP_MS,
  MAX_EVENTS_PER_BEACON,
  VISIT_ENDPOINT,
  actionForHref,
  classifyArrival,
  cleanDetail,
  deviceFromWidth,
  labelFromText,
  makeVisitId,
  quickBackFrom,
  rageBurst,
  visitBody,
  visitPath,
  type Action,
  type Arrived,
  type Tap,
  type VisitContextInput,
  type VisitEventInput,
} from "./rules";

/** A visit sends no more than this many events. */
const MAX_EVENTS_PER_VISIT = 120;
/** Trouble a single page view can report, so one broken page cannot flood a visit. */
const MAX_TROUBLE_PER_PAGE = 6;
const RAGE_SETTLE_MS = 800;
const RAGE_COOLDOWN_MS = 2000;
/** The visit's first send goes soon, so a visit shows up even if the browser dies. */
const FIRST_SEND_MS = 1500;
/** After that, events wait a little so a few go together. */
const LATER_SEND_MS = 5000;
/** Something the visitor did (WhatsApp, a call) goes almost at once. */
const ACTION_SEND_MS = 400;

interface Queued {
  event: VisitEventInput;
  /** performance.now() when it happened. */
  at: number;
}

interface PageStint {
  path: string;
  startedAt: number;
  maxScroll: number;
  trouble: number;
  /** Its time has been reported (the tab was hidden); the next stint starts on return. */
  left: boolean;
}

interface PendingRage {
  path: string;
  label: string | null;
  count: number;
  timer: number;
}

let started = false;
let visit: string | null = null;
let arrival: VisitContextInput | null = null;
let firstSent = false;
let queue: Queued[] = [];
let flushTimer: number | null = null;
let flushDue = Infinity;
let sentEvents = 0;
let page: PageStint | null = null;
let trail: Arrived[] = [];
let taps: Tap[] = [];
let lastRageAt = -Infinity;
let pendingRage: PendingRage | null = null;
const actionsDone = new Set<string>();

/** A tap being watched to see whether anything came of it. */
interface DeadCheck {
  control: Element;
  /** Something near the control changed after the tap. */
  changed: boolean;
}
const deadChecks = new Set<DeadCheck>();
let observer: MutationObserver | null = null;

/* --- Who is not recorded ---------------------------------------------------- */

function notRecorded(): boolean {
  try {
    if (typeof window === "undefined") return true;
    if (navigator.webdriver) return true;
    if ((document as Document & { prerendering?: boolean }).prerendering) return true;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
    if (nav.globalPrivacyControl === true) return true;
    if (navigator.doNotTrack === "1" || nav.msDoNotTrack === "1") return true;
    if ((window as Window & { doNotTrack?: string }).doNotTrack === "1") return true;
    return false;
  } catch {
    return true;
  }
}

/* --- Sending ---------------------------------------------------------------------- */

function post(body: string): void {
  // text/plain keeps sendBeacon a "simple" request: no preflight.
  if (typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon(VISIT_ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
  }
  if (typeof fetch === "function") {
    void fetch(VISIT_ENDPOINT, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "same-origin",
      headers: { "Content-Type": "text/plain" },
    }).catch(() => {});
  }
}

function flush(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushDue = Infinity;
  try {
    if (!visit || queue.length === 0) return;
    if (notRecorded()) {
      queue = [];
      return;
    }
    const now = performance.now();
    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_EVENTS_PER_BEACON);
      const first = !firstSent;
      firstSent = true;
      post(
        visitBody({
          visit,
          first,
          // The device is read when the first send happens, not when the page
          // opens: a tab opened in the background has no width yet.
          context: first && arrival ? { ...arrival, device: deviceFromWidth(window.innerWidth) } : null,
          events: batch.map(({ event, at }) => ({ ...event, agoMs: Math.min(Math.max(Math.round(now - at), 0), 600_000) })),
        })
      );
    }
  } catch {
    // Never into the UI.
  }
}

function schedule(delay: number): void {
  const due = performance.now() + delay;
  if (flushTimer !== null && due >= flushDue) return;
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushDue = due;
  flushTimer = window.setTimeout(flush, delay);
}

function push(event: VisitEventInput, urgent = false): void {
  if (!visit || notRecorded()) return;
  if (sentEvents >= MAX_EVENTS_PER_VISIT) return;
  const path = visitPath(event.path);
  if (!path) return;
  sentEvents += 1;
  queue.push({ event: { ...event, path }, at: performance.now() });
  schedule(urgent ? ACTION_SEND_MS : firstSent ? LATER_SEND_MS : FIRST_SEND_MS);
}

/* --- Pages ------------------------------------------------------------------------------- */

function scrollDepth(): number {
  const root = document.documentElement;
  const total = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
  if (total <= 0) return 0;
  return Math.min(100, Math.round(((window.scrollY + window.innerHeight) / total) * 100));
}

function leavePage(): void {
  if (!page || page.left) return;
  page.left = true;
  push({ kind: "leave", path: page.path, amount: Math.round(performance.now() - page.startedAt), scroll: Math.max(page.maxScroll, scrollDepth()) });
}

function troubleAllowed(): boolean {
  if (!page || page.trouble >= MAX_TROUBLE_PER_PAGE) return false;
  page.trouble += 1;
  return true;
}

/** Called when the page the visitor is on changes (and once for the first). */
export function trackPageView(pathname: string): void {
  try {
    if (typeof window === "undefined" || notRecorded()) return;
    const path = visitPath(pathname);

    // Leaving a page, to a private page or to another public one.
    if (page && page.path !== path) {
      flushPendingRage();
      leavePage();
      page = null;
    }
    if (!path || (page && page.path === path)) {
      if (!path) flush();
      return;
    }

    if (!visit) {
      const bytes = (length: number) => {
        const out = new Uint8Array(length);
        if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(out);
        else for (let i = 0; i < length; i += 1) out[i] = Math.floor(Math.random() * 256);
        return out;
      };
      visit = makeVisitId(bytes);
      const found = classifyArrival({ search: window.location.search, referrer: document.referrer, ownHost: window.location.host });
      arrival = { kind: found.kind, label: found.label, campaign: found.campaign, device: deviceFromWidth(window.innerWidth) };
    }

    page = { path, startedAt: performance.now(), maxScroll: 0, trouble: 0, left: false };
    push({ kind: "view", path });

    trail.push({ path, at: performance.now() });
    if (trail.length > 3) trail = trail.slice(-3);
    const bounced = quickBackFrom(trail);
    if (bounced && troubleAllowed()) push({ kind: "quick_back", path: bounced });
  } catch {
    // Never into the UI.
  }
}

/**
 * Something the visitor did that matters: an enquiry sent, a unit opened. Each
 * action (and unit) counts once per visit. Safe to call from anywhere.
 */
export function trackAction(action: Action, detail?: string | null): void {
  try {
    if (typeof window === "undefined" || !visit || !page) return;
    const clean = action === "unit" ? cleanDetail(detail ?? null) : null;
    const key = `${action}|${clean ?? ""}`;
    if (actionsDone.has(key)) return;
    actionsDone.add(key);
    push({ kind: "act", path: page.path, label: action, detail: clean }, true);
  } catch {
    // Never into the UI.
  }
}

/* --- Trouble ------------------------------------------------------------------------------- */

const CONTROLS = 'a[href], button, [role="button"], summary, input[type="submit"], input[type="button"]';

function controlOf(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest(CONTROLS);
  if (!control) return null;
  if (control.closest("[data-visit-skip]")) return null;
  return control;
}

function labelOf(control: Element | null): string | null {
  if (!control) return null;
  try {
    const own = control.getAttribute("aria-label") ?? (control instanceof HTMLInputElement ? control.value : null);
    if (own) return labelFromText(own);
    const text = (control.textContent ?? "").slice(0, 200);
    return labelFromText(text) ?? labelFromText(control.getAttribute("title"));
  } catch {
    return null;
  }
}

function flushPendingRage(): void {
  if (!pendingRage) return;
  window.clearTimeout(pendingRage.timer);
  const burst = pendingRage;
  pendingRage = null;
  if (page && page.path === burst.path && troubleAllowed()) {
    push({ kind: "rage", path: burst.path, label: burst.label, amount: burst.count });
  }
}

function noteRage(control: Element | null, at: number): void {
  if (!page) return;
  const count = rageBurst(taps);
  if (count === 0) return;
  if (pendingRage) {
    // The burst goes on: it is reported once, with the most taps it reached.
    pendingRage.count = Math.max(pendingRage.count, count);
    window.clearTimeout(pendingRage.timer);
    pendingRage.timer = window.setTimeout(flushPendingRage, RAGE_SETTLE_MS);
    return;
  }
  if (at - lastRageAt < RAGE_COOLDOWN_MS) return;
  lastRageAt = at;
  pendingRage = { path: page.path, label: labelOf(control), count, timer: window.setTimeout(flushPendingRage, RAGE_SETTLE_MS) };
}

function leavesTheSite(control: Element): boolean {
  if (control instanceof HTMLAnchorElement) {
    const href = control.getAttribute("href") ?? "";
    if (control.hasAttribute("download") || control.target === "_blank") return true;
    if (/^(#|mailto:|tel:|sms:|javascript:)/i.test(href)) return true;
    try {
      return new URL(control.href, window.location.href).origin !== window.location.origin;
    } catch {
      return true;
    }
  }
  return false;
}

function disabled(control: Element): boolean {
  return (control as HTMLButtonElement).disabled === true || control.getAttribute("aria-disabled") === "true";
}

/**
 * Did the page do anything where the visitor tapped? Only changes that are the
 * control's own business count: the control itself, anything inside it or around
 * it, and the page's body (a dialog is added there). A map redrawing its tiles
 * somewhere else on the page is not a response to the tap.
 */
function onMutations(records: MutationRecord[]): void {
  const body = document.body;
  const root = document.documentElement;
  for (const check of deadChecks) {
    if (check.changed) continue;
    for (const record of records) {
      const target = record.target;
      if (target === body || target === root || check.control.contains(target) || target.contains(check.control)) {
        check.changed = true;
        break;
      }
    }
  }
}

function watchForNothing(control: Element): void {
  if (!page || deadChecks.size >= 3 || disabled(control) || leavesTheSite(control)) return;
  const where = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const focus = document.activeElement;
  const path = page.path;
  const label = labelOf(control);
  const check: DeadCheck = { control, changed: false };

  deadChecks.add(check);
  if (!observer) {
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  window.setTimeout(() => {
    deadChecks.delete(check);
    if (deadChecks.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
    try {
      if (!page || page.path !== path || notRecorded()) return;
      const nowAt = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const somethingHappened =
        nowAt !== where || check.changed || !control.isConnected || document.activeElement !== focus || document.hidden;
      if (!somethingHappened && troubleAllowed()) push({ kind: "dead", path, label });
    } catch {
      // Never into the UI.
    }
  }, DEAD_TAP_MS);
}

function onClick(event: MouseEvent): void {
  try {
    if (!page || notRecorded()) return;
    const control = controlOf(event.target);
    const at = performance.now();
    taps.push({ at, x: event.clientX, y: event.clientY });
    taps = taps.filter((tap) => at - tap.at < 2000).slice(-10);
    noteRage(control, at);
    if (control instanceof HTMLAnchorElement) {
      const action = actionForHref(control.getAttribute("href"));
      if (action) trackAction(action);
    }
    if (control) watchForNothing(control);
  } catch {
    // Never into the UI.
  }
}

function onScroll(): void {
  if (!page) return;
  page.maxScroll = Math.max(page.maxScroll, scrollDepth());
}

function onError(event: ErrorEvent): void {
  try {
    if (!page || notRecorded()) return;
    // Only this site's own code: a script from somebody else is not what the visitor
    // is stuck on, and a cross-origin error has no information to report.
    if (event.filename && !event.filename.startsWith(window.location.origin)) return;
    if (!event.filename && !event.error) return;
    if (!troubleAllowed()) return;
    const name = event.error instanceof Error ? event.error.name : "Error";
    push({ kind: "error", path: page.path, label: /^[A-Za-z]{1,40}$/.test(name) ? name : "Error" });
  } catch {
    // Never into the UI.
  }
}

function onRejection(event: PromiseRejectionEvent): void {
  try {
    if (!page || notRecorded() || !troubleAllowed()) return;
    const name = event.reason instanceof Error ? event.reason.name : "Rejection";
    push({ kind: "error", path: page.path, label: /^[A-Za-z]{1,40}$/.test(name) ? name : "Rejection" });
  } catch {
    // Never into the UI.
  }
}

/* --- Starting ------------------------------------------------------------------------------ */

/** The tab is hidden or the page is going away: report the time spent and send what is waiting. */
function onHide(): void {
  try {
    flushPendingRage();
    leavePage();
    flush();
  } catch {
    // Never into the UI.
  }
}

function onVisibility(): void {
  if (document.visibilityState === "hidden") {
    onHide();
  } else if (page) {
    // Back on the page: a new stint, timed from now.
    page.left = false;
    page.startedAt = performance.now();
  }
}

export function startVisitRecord(): void {
  try {
    if (started || typeof window === "undefined") return;
    started = true;
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
  } catch {
    // Never into the UI.
  }
}
