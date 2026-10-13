/**
 * The rules of the visit record: what a browser may send, what the server
 * accepts, how an arrival is classed, and how a visit is told in words on the
 * admin dashboard. Pure: no React, no window, no network, so the browser, the
 * server and the dashboard all share it.
 *
 * WHY IT EXISTS (Niko, 13 Oct 2026): "a dashboard on the admin page to check how
 * ads are performing, and how visitors use the site". Google Analytics shows
 * totals; this shows each visit's route: the pages in order, how long each was
 * open, where the visit ended, what the visitor did (an enquiry, WhatsApp, a
 * call, a unit opened) and the moments that suggest something frustrated them.
 *
 * WHAT IT IS NOT. No IP address, no user agent string, no cookie, no name,
 * nothing typed, no picture of the screen and no query string: a page is its
 * path. A visit is a random number the browser makes when the page opens and
 * keeps ONLY IN THE PAGE'S MEMORY, so nothing is stored on the visitor's device
 * and two visits cannot be tied together. Records are deleted after 30 days.
 * Nothing is sent for browsers that say Do Not Track or Global Privacy Control,
 * for the admin, buyer-portal and Studio pages, for scripts or for pages that
 * are only being prerendered.
 *
 * THE BEACON IS UNTRUSTED. Anyone can post anything, so every value is parsed
 * strictly here: a known kind, a plain path, a short label, a number in range.
 * What does not fit is dropped, never stored.
 */

/* --- What a browser can say happened ----------------------------------------- */

export const VISIT_KINDS = ["view", "leave", "rage", "dead", "quick_back", "error", "act"] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];

/** The moments that suggest something went wrong. */
export const TROUBLE_KINDS = ["rage", "dead", "quick_back", "error"] as const satisfies readonly VisitKind[];

export function isVisitKind(value: unknown): value is VisitKind {
  return typeof value === "string" && (VISIT_KINDS as readonly string[]).includes(value);
}

export function isTroubleKind(kind: string): boolean {
  return (TROUBLE_KINDS as readonly string[]).includes(kind);
}

/** Things a visitor did that matter for the business, recorded as `act` events. */
export const ACTIONS = ["enquiry", "whatsapp", "call", "email", "unit", "compare", "photo", "map"] as const;
export type Action = (typeof ACTIONS)[number];

export function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

/** The actions that mean "got in touch". */
export const CONTACT_ACTIONS = ["enquiry", "whatsapp", "call", "email"] as const satisfies readonly Action[];

export function isContactAction(value: string): boolean {
  return (CONTACT_ACTIONS as readonly string[]).includes(value);
}

export const ACTION_NAMES: Record<Action, string> = {
  enquiry: "Sent an enquiry",
  whatsapp: "Tapped WhatsApp",
  call: "Tapped to call",
  email: "Tapped to email",
  unit: "Opened a unit",
  compare: "Compared units",
  photo: "Opened a photo",
  map: "Opened the map",
};

export const SOURCE_KINDS = ["direct", "google_ad", "meta_ad", "other_ad", "search", "social", "email", "site", "other"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const AD_KINDS = ["google_ad", "meta_ad", "other_ad"] as const satisfies readonly SourceKind[];

export const DEVICES = ["phone", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

export const BROWSERS = ["safari", "chrome", "firefox", "edge", "samsung", "opera", "other"] as const;
export type Browser = (typeof BROWSERS)[number];

export const VISIT_ENDPOINT = "/api/visit";
/** A beacon of twenty-five events is well under this; anything near it is not one. */
export const MAX_BEACON_BYTES = 8000;
export const MAX_EVENTS_PER_BEACON = 25;
/** A rage burst: this many taps, within this long, within this far of the first. */
export const RAGE_TAPS = 3;
export const RAGE_WINDOW_MS = 1000;
export const RAGE_RADIUS_PX = 40;
/** Going straight back within this long of arriving is "quick back". */
export const QUICK_BACK_MS = 5000;
/** A tap that changes nothing within this long is "dead". */
export const DEAD_TAP_MS = 1500;

/* --- Paths ----------------------------------------------------------------------- */

const MAX_PATH = 200;
/** Staff, buyer and Studio pages are never recorded. */
const PRIVATE = /^\/(admin|account|login|studio|buyers-studio|api)(\/|$)/i;

/**
 * A page's path as the record keeps it, or null when it is not one to keep: the
 * address without its query or fragment, no trailing slash, and nothing for
 * private pages. Applied by the browser before sending and again by the server.
 */
export function visitPath(pathname: string | null | undefined): string | null {
  if (typeof pathname !== "string") return null;
  const bare = pathname.split(/[?#]/)[0] ?? "";
  if (!bare.startsWith("/")) return null;
  let path = bare.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (/[\s\u0000-\u001f\u007f]/.test(path)) return null;
  if (PRIVATE.test(path)) return null;
  return path.length > 0 && path.length <= MAX_PATH ? path : null;
}

/* --- Labels ------------------------------------------------------------------------ */

const MAX_LABEL = 40;

/**
 * What a visitor tapped, as words: the control's own text, cut to 40 characters,
 * with anything that could be a person's cut out first (an email address, a long
 * number). Null when nothing is left. A label is a button's name, never typing.
 */
export function labelFromText(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const cleaned = text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "")
    .replace(/\+?\d[\d\s().-]{4,}\d/g, "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** A utm value or a host as a short plain label ("Ghana Traffic!" -> "ghana-traffic"), or "". */
export function cleanLabel(value: string | null | undefined, max = 40): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** A unit number or similar short detail ("204B", "PH2b"), or null. */
export function cleanDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 12);
  return /^[A-Za-z0-9][A-Za-z0-9 .-]{0,11}$/.test(text) ? text : null;
}

/* --- How a visit arrived --------------------------------------------------------------- */

export interface Arrival {
  kind: SourceKind;
  /** The advertiser's source, or the site it came from. Plain, up to 60 characters; "" when none. */
  label: string;
  /** The campaign's name when the address carried one. */
  campaign: string;
}

const SEARCH_HOSTS = ["google.", "bing.", "duckduckgo.", "yahoo.", "yandex.", "ecosia.", "baidu.", "brave.", "startpage."];
const SOCIAL_HOSTS = [
  "facebook.com", "fb.com", "fb.me", "instagram.com", "l.instagram.com", "t.co", "twitter.com", "x.com",
  "tiktok.com", "youtube.com", "youtu.be", "linkedin.com", "lnkd.in", "whatsapp.com", "wa.me", "pinterest.com",
  "reddit.com", "telegram.org", "t.me",
];
const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsocial", "paid-social", "paid_social", "display", "video", "cpm", "ads", "ad"]);
const GOOGLE_SOURCES = new Set(["google", "youtube", "bing"]);
const META_SOURCES = new Set(["meta", "facebook", "instagram", "fb", "ig"]);
const SOCIAL_SOURCES = new Set(["facebook", "instagram", "tiktok", "youtube", "whatsapp", "twitter", "x", "linkedin", "meta"]);

function hostOf(referrer: string | null | undefined): string {
  if (typeof referrer !== "string" || referrer.length === 0) return "";
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostIs(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

/**
 * How a visit arrived, from the address's query string and the page it came
 * from. Only labels leave this function: never the referrer's address, never a
 * click id's value (its presence says "an advert"; its value identifies a click).
 * A visit that arrived from one of our own pages (`ownHost`) is not an arrival.
 */
export function classifyArrival(input: { search?: string | null; referrer?: string | null; ownHost?: string | null }): Arrival {
  let params = new URLSearchParams();
  try {
    if (typeof input.search === "string" && input.search.length > 0 && input.search.length <= 2000) {
      params = new URLSearchParams(input.search);
    }
  } catch {
    params = new URLSearchParams();
  }
  const source = cleanLabel(params.get("utm_source"));
  const medium = cleanLabel(params.get("utm_medium"));
  const campaign = cleanLabel(params.get("utm_campaign")).replace(/\./g, "-");
  const host = hostOf(input.referrer);
  const own = (input.ownHost ?? "").toLowerCase().replace(/^www\./, "");
  const external = host !== "" && !(own !== "" && hostIs(host, own)) ? host : "";

  const clickedGoogleAd = params.has("gclid") || params.has("gbraid") || params.has("wbraid");
  const clickedMetaAd = params.has("fbclid");

  if (clickedGoogleAd) return { kind: "google_ad", label: source || "google", campaign };
  if (PAID_MEDIUMS.has(medium)) {
    if (GOOGLE_SOURCES.has(source)) return { kind: "google_ad", label: source, campaign };
    if (META_SOURCES.has(source)) return { kind: "meta_ad", label: source, campaign };
    return { kind: "other_ad", label: source, campaign };
  }
  if (source === "email" || medium === "email") return { kind: "email", label: source || "email", campaign };
  // Our own posts say so (the daily Facebook posts use utm_medium=organic_social).
  // Facebook adds its click id to every link people tap, posts included, so here
  // the click id does not make it an advert.
  if (medium.includes("organic") || medium === "social") return { kind: "social", label: source || "social", campaign };
  if (source === "google") return { kind: "google_ad", label: source, campaign };
  if (source === "meta") return { kind: "meta_ad", label: source, campaign };
  if (SOCIAL_SOURCES.has(source)) {
    return clickedMetaAd ? { kind: "meta_ad", label: source, campaign } : { kind: "social", label: source, campaign };
  }
  // A Meta click id with no labels: today that is mostly a lead-form advert's
  // "see the apartments" link, so it counts as Meta advertising.
  if (clickedMetaAd) return { kind: "meta_ad", label: source || "facebook", campaign };
  if (source) return { kind: "other", label: source, campaign };

  if (external === "") return { kind: "direct", label: "", campaign };
  if (SEARCH_HOSTS.some((base) => host.startsWith(base) || host.includes(`.${base}`))) {
    return { kind: "search", label: cleanLabel(external, 60), campaign };
  }
  if (SOCIAL_HOSTS.some((base) => hostIs(host, base))) return { kind: "social", label: cleanLabel(external, 60), campaign };
  return { kind: "site", label: cleanLabel(external, 60), campaign };
}

/* --- Device, browser, country ----------------------------------------------------------- */

export function deviceFromWidth(width: number): Device {
  // A page with no width yet (a tab opened in the background reports 0) is not a phone.
  if (!Number.isFinite(width) || width <= 0) return "desktop";
  return width < 640 ? "phone" : width < 1024 ? "tablet" : "desktop";
}

/** The browser's family from its user agent, and nothing more of it is kept. */
export function browserFromUserAgent(userAgent: string | null | undefined): Browser {
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Edg(e|A|iOS)?\//i.test(ua)) return "edge";
  if (/OPR\/|Opera|OPT\//i.test(ua)) return "opera";
  if (/Firefox\/|FxiOS\//i.test(ua)) return "firefox";
  if (/CriOS\/|Chrome\//i.test(ua)) return "chrome";
  if (/Safari\//i.test(ua)) return "safari";
  return "other";
}

/** Vercel's country header: two capital letters, or null. "XX" and "T1" are unknowns. */
export function countryFromHeader(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}

const BOT_PATTERN =
  /bot\/|bot;|bot-|\+https?:\/\/|crawl|spider|slurp|facebookexternalhit|facebookcatalog|^WhatsApp\/|TelegramBot|Twitterbot|LinkedInBot|Discordbot|Slackbot|Embedly|HeadlessChrome|Lighthouse|PTST|python-requests|python-urllib|aiohttp|curl\/|wget|node-fetch|undici|axios|Go-http-client|okhttp|Java\/|Scrapy|Prerender|vercel-|Googlebot|bingbot|YandexBot|Baiduspider|DuckDuckBot|AhrefsBot|SemrushBot|MJ12bot|PetalBot|Bytespider|GPTBot|ClaudeBot|CCBot|Applebot|Google-InspectionTool/i;

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== "string") return true;
  const ua = userAgent.trim();
  return ua.length === 0 || BOT_PATTERN.test(ua);
}

/**
 * Did this POST come from a page on this site? Sec-Fetch-Site `same-origin`, or
 * an Origin naming the host it was sent to. A prefetch or prerender is not a
 * person looking at anything. A script can set all of these; the point is to
 * refuse the cheap cases without storing anything about the request.
 */
export function isFirstPartyBeacon(headers: {
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
  forwardedHost: string | null;
  secPurpose: string | null;
}): boolean {
  const purpose = headers.secPurpose?.toLowerCase() ?? "";
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return false;
  const site = headers.secFetchSite?.toLowerCase() ?? null;
  if (site !== null) return site === "same-origin";
  if (!headers.origin) return false;
  let originHost: string;
  try {
    originHost = new URL(headers.origin).host.toLowerCase();
  } catch {
    return false;
  }
  const hosts = [headers.host, headers.forwardedHost]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase());
  return hosts.includes(originHost);
}

/* --- The beacon --------------------------------------------------------------------------- */

export interface VisitEventInput {
  kind: VisitKind;
  path: string;
  /** `rage`/`dead`/`error`: what was tapped or the error's name. `act`: which action. */
  label?: string | null;
  /** `leave`: how long the page was open (ms). `rage`: how many taps. */
  amount?: number | null;
  /** `leave`: how far down the page, 0 to 100. */
  scroll?: number | null;
  /** `act` on a unit: the unit's number. */
  detail?: string | null;
  /** How long before the send it happened (ms), so a batch keeps its order. */
  agoMs?: number;
}

export interface VisitContextInput {
  kind: SourceKind;
  label: string;
  campaign: string;
  device: Device;
}

export interface VisitBeacon {
  visit: string;
  /** The visit's first send: it carries how the visit arrived. */
  first: boolean;
  context: VisitContextInput | null;
  events: VisitEventInput[];
}

export const VISIT_ID = /^[a-z0-9]{12,24}$/;

/** The id a browser makes for a visit: 16 random base-36 characters. */
export function makeVisitId(random: (length: number) => Uint8Array): string {
  const bytes = random(16);
  let id = "";
  for (let i = 0; i < 16; i += 1) id += (bytes[i] % 36).toString(36);
  return id;
}

function int(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : null;
}

/** The body a browser sends (see `parseVisitBeacon` for what is read back). */
export function visitBody(beacon: VisitBeacon): string {
  const body: Record<string, unknown> = { v: beacon.visit, e: beacon.events.map(eventBody) };
  if (beacon.first) body.n = 1;
  if (beacon.context) {
    body.c = { s: beacon.context.kind, l: beacon.context.label, p: beacon.context.campaign, d: beacon.context.device };
  }
  return JSON.stringify(body);
}

function eventBody(event: VisitEventInput): Record<string, unknown> {
  const out: Record<string, unknown> = { k: event.kind, p: event.path };
  if (event.label) out.l = event.label;
  if (event.amount != null) out.m = event.amount;
  if (event.scroll != null) out.s = event.scroll;
  if (event.detail) out.x = event.detail;
  if (event.agoMs) out.t = event.agoMs;
  return out;
}

/**
 * Strict parse of what a browser sent. Null for anything that is not exactly a
 * beacon; an event that does not fit is dropped from a beacon that otherwise does.
 */
export function parseVisitBeacon(raw: string): VisitBeacon | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_BEACON_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.v !== "string" || !VISIT_ID.test(body.v)) return null;
  if (!Array.isArray(body.e) || body.e.length === 0 || body.e.length > MAX_EVENTS_PER_BEACON) return null;

  const events: VisitEventInput[] = [];
  for (const item of body.e) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (!isVisitKind(e.k) || typeof e.p !== "string") continue;
    const path = visitPath(e.p);
    if (!path) continue;
    const event: VisitEventInput = { kind: e.k, path };
    if (e.k === "act") {
      if (!isAction(e.l)) continue;
      event.label = e.l;
      const detail = cleanDetail(e.x);
      if (detail && e.l === "unit") event.detail = detail;
    } else {
      const label = typeof e.l === "string" ? labelFromText(e.l) : null;
      if (label && (e.k === "rage" || e.k === "dead" || e.k === "error")) event.label = label;
    }
    const amount = int(e.m, 0, 7_200_000);
    if (amount !== null && (e.k === "leave" || e.k === "rage")) event.amount = amount;
    const scroll = int(e.s, 0, 100);
    if (scroll !== null && e.k === "leave") event.scroll = scroll;
    const ago = int(e.t, 0, 600_000);
    if (ago) event.agoMs = ago;
    events.push(event);
  }
  if (events.length === 0) return null;

  let context: VisitContextInput | null = null;
  if (body.c && typeof body.c === "object" && !Array.isArray(body.c)) {
    const c = body.c as Record<string, unknown>;
    const kind = (SOURCE_KINDS as readonly string[]).includes(c.s as string) ? (c.s as SourceKind) : "direct";
    const device = (DEVICES as readonly string[]).includes(c.d as string) ? (c.d as Device) : "desktop";
    context = {
      kind,
      label: typeof c.l === "string" ? cleanLabel(c.l, 60) : "",
      campaign: typeof c.p === "string" ? cleanLabel(c.p, 40).replace(/\./g, "-") : "",
      device,
    };
  }
  return { visit: body.v, first: body.n === 1, context, events };
}

/* --- Noticing trouble (pure parts; the browser feeds them) -------------------------------------- */

export interface Tap {
  at: number;
  x: number;
  y: number;
}

/**
 * Taps on the same spot, again and again: the latest tap plus at least two more
 * within a second and within 40 pixels of it. `taps` is every recent tap, oldest
 * first; the answer is how many belong to the burst (0 when it is not one).
 */
export function rageBurst(taps: readonly Tap[]): number {
  if (taps.length < RAGE_TAPS) return 0;
  const last = taps[taps.length - 1];
  let count = 0;
  for (let i = taps.length - 1; i >= 0; i -= 1) {
    const tap = taps[i];
    if (last.at - tap.at > RAGE_WINDOW_MS) break;
    if (Math.hypot(tap.x - last.x, tap.y - last.y) <= RAGE_RADIUS_PX) count += 1;
  }
  return count >= RAGE_TAPS ? count : 0;
}

export interface Arrived {
  path: string;
  at: number;
}

/**
 * Going straight back. `trail` is the pages seen in order, newest last. When the
 * newest is the page BEFORE the one just left, and that one was open less than
 * five seconds, the visitor bounced off it: the answer is that page, else null.
 */
export function quickBackFrom(trail: readonly Arrived[]): string | null {
  if (trail.length < 3) return null;
  const now = trail[trail.length - 1];
  const middle = trail[trail.length - 2];
  const before = trail[trail.length - 3];
  if (now.path !== before.path || now.path === middle.path) return null;
  return now.at - middle.at < QUICK_BACK_MS ? middle.path : null;
}

/**
 * Which action a tapped link is, from its address: WhatsApp, a call, an email
 * or a map. Null for every other link.
 */
export function actionForHref(href: string | null | undefined): Action | null {
  if (typeof href !== "string" || href.length === 0) return null;
  if (/^tel:/i.test(href)) return "call";
  if (/^mailto:/i.test(href)) return "email";
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "wa.me" || host === "api.whatsapp.com" || (host === "whatsapp.com" && url.pathname.startsWith("/send"))) {
    return "whatsapp";
  }
  if (host === "maps.app.goo.gl" || host.startsWith("maps.google.") || (host === "goo.gl" && url.pathname.startsWith("/maps"))) {
    return "map";
  }
  if (/^google\.[a-z.]+$/.test(host) && url.pathname.startsWith("/maps")) return "map";
  return null;
}

/* --- Telling a visit in words (the dashboard) ----------------------------------------------- */

const PAGE_NAMES: readonly [pattern: RegExp, name: string][] = [
  [/^\/$/, "Home"],
  [/^\/residences$/, "Residences"],
  [/^\/amenities$/, "Amenities"],
  [/^\/gallery$/, "Gallery"],
  [/^\/progress$/, "Progress"],
  [/^\/invest$/, "Invest"],
  [/^\/contact$/, "Contact"],
  [/^\/about$/, "About"],
  [/^\/privacy$/, "Privacy"],
];

/** A page in the words a person would use, or the path itself when none fits. */
export function pageName(path: string): string {
  for (const [pattern, name] of PAGE_NAMES) if (pattern.test(path)) return name;
  return path;
}

const SOURCE_PHRASES: Record<SourceKind, string> = {
  direct: "came straight in",
  google_ad: "came from a Google ad",
  meta_ad: "came from a Meta ad",
  other_ad: "came from an ad",
  search: "came from a search engine",
  social: "came from social media",
  email: "came from an email",
  site: "came from another site",
  other: "came from a link",
};

/** "came from a Meta ad (ghana-traffic)", "came from google.com", "came straight in". */
export function arrivalPhrase(kind: string, label: string | null, campaign: string | null): string {
  const base = SOURCE_PHRASES[kind as SourceKind] ?? SOURCE_PHRASES.other;
  const detail =
    kind === "search" || kind === "site"
      ? label
      : campaign
        ? campaign
        : kind === "social"
          ? label
          : null;
  return detail ? `${base} (${detail})` : base;
}

const KIND_NAMES: Record<string, string> = {
  direct: "Straight in",
  google_ad: "Google ads",
  meta_ad: "Meta ads",
  other_ad: "Other ads",
  search: "Search engines",
  social: "Social media",
  email: "Email",
  site: "Other sites",
  other: "Other links",
};

export function sourceName(kind: string): string {
  return KIND_NAMES[kind] ?? kind;
}

/** What went wrong, in a few words: "tapped “Next” 4 times in a row". */
export function troubleText(kind: string, label: string | null, amount: number | null): string {
  const what = label ? `“${label}”` : "the page";
  switch (kind) {
    case "rage":
      return amount && amount > 1 ? `tapped ${what} ${amount} times in a row` : `tapped ${what} again and again`;
    case "dead":
      return `tapped ${what} and nothing happened`;
    case "quick_back":
      return "went straight back from here";
    case "error":
      return label ? `the page broke (${label})` : "the page broke";
    default:
      return kind;
  }
}

/** How long, as a person says it: "9 s", "2 min", "1 h 5 min". */
export function durationText(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
