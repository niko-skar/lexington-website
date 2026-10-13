/**
 * The dashboard's logic for the visit record, apart from the database: which
 * days it can show, how a visit's events become the steps of its story, and the
 * totals. Pure, so it can be tested; `store.ts` reads and writes the records.
 */
import {
  AD_KINDS,
  isAction,
  isContactAction,
  isTroubleKind,
  isVisitKind,
  pageName,
  type Action,
  type Browser,
  type Device,
  type SourceKind,
  type VisitKind,
} from "./rules";

/* --- What is stored ---------------------------------------------------------------------- */

/** How one visit arrived: written once, with the visit's first send. */
export interface StoredVisit {
  _key: string;
  v: string;
  at: string;
  src: SourceKind;
  label?: string;
  campaign?: string;
  device?: Device;
  country?: string;
  browser?: Browser;
}

/** One thing that happened in a visit. */
export interface StoredEvent {
  _key: string;
  v: string;
  at: string;
  k: VisitKind;
  p: string;
  l?: string;
  m?: number;
  s?: number;
  x?: string;
}

/* --- Which days ------------------------------------------------------------------------ */

export const VISIT_RANGES = ["today", "yesterday", "7d", "30d"] as const;
export type VisitRange = (typeof VISIT_RANGES)[number];

export const RANGE_LABELS: Record<VisitRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export function parseRange(value: unknown, fallback: VisitRange = "7d"): VisitRange {
  return (VISIT_RANGES as readonly string[]).includes(value as string) ? (value as VisitRange) : fallback;
}

/** The time now, for server pages (which render once per request). */
export function currentTimeMs(): number {
  return Date.now();
}

/** The UTC date of a moment, as YYYY-MM-DD. Accra is UTC+0 all year, so this is Accra's day. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `day` moved by a whole number of days (negative goes back). */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The days a range covers, oldest first. */
export function rangeDays(range: VisitRange, nowMs: number): string[] {
  const today = utcDay(nowMs);
  if (range === "today") return [today];
  if (range === "yesterday") return [shiftDay(today, -1)];
  const span = range === "7d" ? 7 : 30;
  return Array.from({ length: span }, (_, i) => shiftDay(today, i - (span - 1)));
}

/* --- Which visits ------------------------------------------------------------------------ */

export const VISIT_FILTERS = ["all", "acted", "trouble", "one_page", "ads", "phone"] as const;
export type VisitFilter = (typeof VISIT_FILTERS)[number];

export const FILTER_LABELS: Record<VisitFilter, string> = {
  all: "All visits",
  acted: "Got in touch",
  trouble: "Something went wrong",
  one_page: "Left after one page",
  ads: "From ads",
  phone: "On a phone",
};

export function parseFilter(value: unknown): VisitFilter {
  return (VISIT_FILTERS as readonly string[]).includes(value as string) ? (value as VisitFilter) : "all";
}

export const PAGE_SIZE = 30;
export const MAX_SHOWN = 300;

export function parseLimit(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n < PAGE_SIZE) return PAGE_SIZE;
  return Math.min(Math.floor(n / PAGE_SIZE) * PAGE_SIZE, MAX_SHOWN);
}

/* --- One visit's story ------------------------------------------------------------------------ */

export interface TroubleStep {
  kind: VisitKind;
  label: string | null;
  /** Taps, for a burst of them. */
  amount: number | null;
}

export interface DoneThing {
  action: Action;
  detail: string | null;
}

export interface Step {
  path: string;
  /** In words: "Residences", "Contact". */
  name: string;
  at: string;
  /** Seconds the page was open, over every stint; null when its leave never arrived. */
  seconds: number | null;
  /** How far down the page they got, 0 to 100, or null. */
  scroll: number | null;
  trouble: TroubleStep[];
  done: DoneThing[];
  /** The last page of the visit: where they went. */
  leftHere: boolean;
}

/**
 * The steps of a visit from its events, oldest first. A page seen starts a step;
 * its time and scroll come from the leaves that follow (a visitor who hides the
 * tab and returns leaves twice, so the times add); trouble and actions belong to
 * the page they happened on. A visit with no events has no steps.
 */
export function buildSteps(events: readonly StoredEvent[]): Step[] {
  const steps: Step[] = [];
  const stepFor = (path: string): Step | undefined => {
    for (let i = steps.length - 1; i >= 0; i -= 1) if (steps[i].path === path) return steps[i];
    return steps[steps.length - 1];
  };
  const newStep = (event: StoredEvent): Step => ({
    path: event.p,
    name: pageName(event.p),
    at: event.at,
    seconds: null,
    scroll: null,
    trouble: [],
    done: [],
    leftHere: false,
  });

  for (const event of events) {
    if (!isVisitKind(event.k)) continue;
    if (event.k === "view") {
      steps.push(newStep(event));
      continue;
    }
    // A visit whose first view never arrived: its first event still has a page.
    if (steps.length === 0) steps.push(newStep(event));
    const step = stepFor(event.p);
    if (!step) continue;
    if (event.k === "leave") {
      if (typeof event.m === "number") step.seconds = (step.seconds ?? 0) + event.m / 1000;
      if (typeof event.s === "number") step.scroll = Math.max(step.scroll ?? 0, event.s);
    } else if (event.k === "act") {
      if (isAction(event.l)) step.done.push({ action: event.l, detail: event.x ?? null });
    } else if (isTroubleKind(event.k)) {
      step.trouble.push({ kind: event.k, label: event.l ?? null, amount: event.k === "rage" ? (event.m ?? null) : null });
    }
  }
  if (steps.length > 0) steps[steps.length - 1].leftHere = true;
  return steps;
}

export interface VisitStory {
  id: string;
  firstAt: string;
  lastAt: string;
  /** Time on the site in seconds (the pages' open time added up), or null when unknown. */
  seconds: number | null;
  country: string | null;
  device: Device | null;
  browser: Browser | null;
  sourceKind: SourceKind;
  sourceLabel: string | null;
  campaign: string | null;
  pages: number;
  flags: number;
  done: DoneThing[];
  contacted: boolean;
  steps: Step[];
}

/**
 * Every visit whose first moment falls in `[from, to)`, newest first. Visits
 * are put together from their events wherever they were stored (a visit across
 * midnight sits in two days' records); how it arrived comes from its first send.
 */
export function buildStories(
  visits: readonly StoredVisit[],
  events: readonly StoredEvent[],
  bounds: { from: string; to: string }
): VisitStory[] {
  const byVisit = new Map<string, StoredEvent[]>();
  for (const event of events) {
    if (!event || typeof event.v !== "string" || typeof event.at !== "string") continue;
    const list = byVisit.get(event.v);
    if (list) list.push(event);
    else byVisit.set(event.v, [event]);
  }
  const meta = new Map<string, StoredVisit>();
  for (const visit of visits) {
    if (!visit || typeof visit.v !== "string") continue;
    const known = meta.get(visit.v);
    if (!known || visit.at < known.at) meta.set(visit.v, visit);
  }

  const stories: VisitStory[] = [];
  const ids = new Set<string>([...byVisit.keys(), ...meta.keys()]);
  for (const id of ids) {
    const list = (byVisit.get(id) ?? []).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const info = meta.get(id);
    const firstAt = [info?.at, list[0]?.at].filter((x): x is string => typeof x === "string").sort()[0];
    if (!firstAt || firstAt < bounds.from || firstAt >= bounds.to) continue;
    const lastAt = list.length > 0 ? list[list.length - 1].at : firstAt;

    const steps = buildSteps(list);
    const done: DoneThing[] = [];
    const seen = new Set<string>();
    for (const step of steps) {
      for (const thing of step.done) {
        const key = `${thing.action}|${thing.detail ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        done.push(thing);
      }
    }
    const timed = steps.filter((step) => step.seconds != null);
    const seconds = timed.length > 0
      ? timed.reduce((sum, step) => sum + (step.seconds ?? 0), 0)
      : Math.max(0, (Date.parse(lastAt) - Date.parse(firstAt)) / 1000) || null;

    stories.push({
      id,
      firstAt,
      lastAt,
      seconds,
      country: info?.country ?? null,
      device: info?.device ?? null,
      browser: info?.browser ?? null,
      sourceKind: info?.src ?? "direct",
      sourceLabel: info?.label ?? null,
      campaign: info?.campaign ?? null,
      pages: steps.length,
      flags: steps.reduce((sum, step) => sum + step.trouble.length, 0),
      done,
      contacted: done.some((thing) => isContactAction(thing.action)),
      steps,
    });
  }
  return stories.sort((a, b) => (a.firstAt < b.firstAt ? 1 : a.firstAt > b.firstAt ? -1 : 0));
}

export function filterStories(stories: readonly VisitStory[], filter: VisitFilter): VisitStory[] {
  switch (filter) {
    case "acted":
      return stories.filter((story) => story.contacted);
    case "trouble":
      return stories.filter((story) => story.flags > 0);
    case "one_page":
      return stories.filter((story) => story.pages <= 1);
    case "ads":
      return stories.filter((story) => (AD_KINDS as readonly string[]).includes(story.sourceKind));
    case "phone":
      return stories.filter((story) => story.device === "phone");
    default:
      return [...stories];
  }
}

/* --- The totals --------------------------------------------------------------------------- */

export interface PageFigure {
  path: string;
  views: number;
  exits: number;
  /** Average seconds open, over the views whose time is known. */
  seconds: number | null;
}

export interface TroubleFigure {
  path: string;
  kind: VisitKind;
  label: string;
  n: number;
}

export interface CountFigure {
  key: string;
  n: number;
}

export interface DayFigure {
  day: string;
  visits: number;
  contacted: number;
}

export interface Overview {
  visits: number;
  onePage: number;
  pagesAvg: number;
  flagged: number;
  contacted: number;
  /** The middle visit's time on the site, in seconds. */
  medianSeconds: number | null;
  pages: PageFigure[];
  entries: CountFigure[];
  trouble: TroubleFigure[];
  sources: CountFigure[];
  devices: CountFigure[];
  countries: CountFigure[];
  /** Visits that did each thing (each thing counted once per visit). */
  actions: CountFigure[];
  /** Units opened, most opened first. */
  units: CountFigure[];
  byDay: DayFigure[];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function tally(keys: Iterable<string | null | undefined>): CountFigure[] {
  const counts = new Map<string, number>();
  for (const key of keys) {
    const k = key ?? "";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

export function overviewOf(stories: readonly VisitStory[], days: readonly string[]): Overview {
  const pages = new Map<string, { views: number; exits: number; secondsSum: number; secondsN: number }>();
  const trouble = new Map<string, TroubleFigure>();
  const actionVisits = new Map<string, number>();
  const unitVisits = new Map<string, number>();
  let pageViews = 0;

  for (const story of stories) {
    pageViews += story.pages;
    for (const step of story.steps) {
      const figure = pages.get(step.path) ?? { views: 0, exits: 0, secondsSum: 0, secondsN: 0 };
      figure.views += 1;
      if (step.leftHere) figure.exits += 1;
      if (step.seconds != null) {
        figure.secondsSum += step.seconds;
        figure.secondsN += 1;
      }
      pages.set(step.path, figure);
      for (const item of step.trouble) {
        const label = item.label ?? "";
        const key = `${step.path}|${item.kind}|${label}`;
        const known = trouble.get(key) ?? { path: step.path, kind: item.kind, label, n: 0 };
        known.n += 1;
        trouble.set(key, known);
      }
    }
    const actionsHere = new Set(story.done.map((thing) => thing.action));
    for (const action of actionsHere) actionVisits.set(action, (actionVisits.get(action) ?? 0) + 1);
    const unitsHere = new Set(story.done.filter((thing) => thing.action === "unit" && thing.detail).map((thing) => thing.detail as string));
    for (const unit of unitsHere) unitVisits.set(unit, (unitVisits.get(unit) ?? 0) + 1);
  }

  const dayIndex = new Map(days.map((day) => [day, { day, visits: 0, contacted: 0 }]));
  for (const story of stories) {
    const figure = dayIndex.get(story.firstAt.slice(0, 10));
    if (!figure) continue;
    figure.visits += 1;
    if (story.contacted) figure.contacted += 1;
  }

  const visits = stories.length;
  return {
    visits,
    onePage: stories.filter((story) => story.pages <= 1).length,
    pagesAvg: visits > 0 ? pageViews / visits : 0,
    flagged: stories.filter((story) => story.flags > 0).length,
    contacted: stories.filter((story) => story.contacted).length,
    medianSeconds: median(stories.map((story) => story.seconds).filter((s): s is number => s != null)),
    pages: [...pages.entries()]
      .map(([path, f]) => ({ path, views: f.views, exits: f.exits, seconds: f.secondsN > 0 ? f.secondsSum / f.secondsN : null }))
      .sort((a, b) => b.exits - a.exits || b.views - a.views)
      .slice(0, 12),
    entries: tally(stories.map((story) => story.steps[0]?.path)).filter((e) => e.key).slice(0, 8),
    trouble: [...trouble.values()].sort((a, b) => b.n - a.n).slice(0, 10),
    sources: tally(stories.map((story) => story.sourceKind)),
    devices: tally(stories.map((story) => story.device ?? "")),
    countries: tally(stories.map((story) => story.country ?? "")).slice(0, 8),
    actions: [...actionVisits.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n),
    units: [...unitVisits.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)).slice(0, 8),
    byDay: [...dayIndex.values()],
  };
}

/** A share as a whole percent, 0 when there is nothing to divide. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/* --- Where visits came from, and what they did (the Ads tab) ------------------------------- */

export interface SourceLine {
  key: string;
  kind: SourceKind;
  label: string;
  campaign: string;
  visits: number;
  onePage: number;
  medianSeconds: number | null;
  contacted: number;
  enquiries: number;
  whatsapp: number;
  calls: number;
  units: number;
}

/**
 * The visits grouped by where they came from (an advert's campaign, a search
 * engine, straight in), with what each group went on to do. Each thing is
 * counted once per visit. Busiest first.
 */
export function sourceLines(stories: readonly VisitStory[]): SourceLine[] {
  const lines = new Map<string, { line: SourceLine; times: number[] }>();
  for (const story of stories) {
    const label = story.sourceKind === "direct" ? "" : (story.sourceLabel ?? "");
    const campaign = story.campaign ?? "";
    const key = `${story.sourceKind}|${label}|${campaign}`;
    const entry = lines.get(key) ?? {
      line: { key, kind: story.sourceKind, label, campaign, visits: 0, onePage: 0, medianSeconds: null, contacted: 0, enquiries: 0, whatsapp: 0, calls: 0, units: 0 },
      times: [],
    };
    const line = entry.line;
    line.visits += 1;
    if (story.pages <= 1) line.onePage += 1;
    if (story.contacted) line.contacted += 1;
    const did = new Set(story.done.map((thing) => thing.action));
    if (did.has("enquiry")) line.enquiries += 1;
    if (did.has("whatsapp")) line.whatsapp += 1;
    if (did.has("call")) line.calls += 1;
    if (did.has("unit")) line.units += 1;
    if (story.seconds != null) entry.times.push(story.seconds);
    lines.set(key, entry);
  }
  return [...lines.values()]
    .map(({ line, times }) => ({ ...line, medianSeconds: median(times) }))
    .sort((a, b) => b.visits - a.visits || a.key.localeCompare(b.key));
}
