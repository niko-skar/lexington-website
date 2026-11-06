import "server-only";

import { randomUUID } from "node:crypto";

import { readGoogleReport, type StoredGoogleReport } from "@/lib/ads/googleStore";
import { leadsOf, metaConfig, type MetaConfig } from "@/lib/ads/meta";
import { MetaError, metaGraph } from "@/lib/ads/metaGraph";
import { notifyOwner } from "@/lib/alerts/notify";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buildStories, shiftDay } from "@/lib/visits/report";
import { readVisitLogs } from "@/lib/visits/store";

import { checkGoogleHealth, type GoogleFix, type GoogleHealth, type HealthProblem } from "./adsHealthCore";
import { MIN_DAILY, dayIn, monthStart, pilotSettings, planPilot, usd, type Holder, type PilotChange, type PilotPlan } from "./adsPilotCore";
import { loadFactPack } from "./facts";
import { allowedAmounts, longDate, soldOutWords } from "./factsCore";

/**
 * THE ADS AUTOPILOT. Every morning at 6 (GMT) it reads what each Facebook / Instagram
 * and Google campaign spent and brought in, works out today's budgets with the rules in
 * adsPilotCore.ts (the month's budget, $200 unless ADS_MONTHLY_BUDGET says otherwise,
 * paced over the days left; the money following real leads), and makes the changes: on
 * Meta straight away, with the ad account key (META_ADS_ACCESS_TOKEN, which needs the
 * ads_management permission to change anything); on Google through the hourly Google Ads
 * script, which collects them from /api/ads/google-plan.
 *
 * THE SAFETY NET. On the first run of each month it resets Meta's own account spending
 * limit and sets it to what is left of the month's budget: even if everything here broke,
 * Meta stops by itself once the money is spent.
 *
 * The dashboard's Pause stops it changing adverts (the spending limit is still renewed
 * each month); ADS_PILOT=off stops it altogether and ADS_PILOT=dry makes it only work out
 * what it would do (the default anywhere but the live site). It never creates, edits or
 * extends an advert: only budgets, and pausing or switching back on.
 *
 * THE DAILY ADS HEALTH CHECK (adsHealthCore.ts, from 6 Nov 2026) runs with it: map pins and
 * out-of-date words are taken off the Google adverts (by the version 3 script), an out-of-date
 * ad is paused when its group has a right one, and when Google's paid clicks don't reach the
 * website for no reason it can see, Google is stopped (`googleHold`) until Claude, prompted by
 * the alert and the daily watcher, finds the cause and clears it. Each new problem is one alert.
 *
 * What it did, and what it needs to remember, lives in one private document
 * (`agentRun.adsPilot`); the switch in `agentConfig.adsPilot`.
 */

const PROD = process.env.VERCEL_ENV === "production";
const RUN_ID = PROD ? "agentRun.adsPilot" : "agentRun.adsPilot-dev";
const SWITCH_ID = PROD ? "agentConfig.adsPilot" : "agentConfig.adsPilot-dev";
const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12);

/** How long the Google script may still make a change after it was decided. */
const GOOGLE_PLAN_MINUTES = 75;
/**
 * The health check judges Google's clicks from this day on: the map pins came off on the evening of 5 Nov 2026, so
 * the days before would only say again what is already fixed. A fix that takes pins off moves it to the next day.
 */
const HEALTH_FROM = "2026-11-06";
/** The Google report counts as current for this long (the script sends one every hour). */
const GOOGLE_FRESH_HOURS = 30;

export { pilotSettings, type PilotMode, type PilotSettings } from "./adsPilotCore";

// ---- what is kept --------------------------------------------------------------------

interface DayMark {
  _key: string;
  id: string;
  day: string;
}

export interface PilotRunChange extends PilotChange {
  _key: string;
  day: string;
  /** Made on Meta, handed to the Google script, or not made (a trial run, paused, or refused). */
  done: "made" | "queued" | "not";
  error?: string;
}

export interface GooglePlan {
  issuedAt: string;
  validUntil: string;
  maxDaily: number;
  campaigns: Array<{ _key: string; id: string; name: string; dailyBudget?: number; status?: "ENABLED" | "PAUSED" }>;
  /** The health check's fixes for the version 3 script: take a link off the adverts, or pause an ad. */
  fixes?: Array<{ _key: string; id: string; op: GoogleFix["op"]; resource: string; what: string }>;
}

/** The daily ads health check's latest findings, for the dashboard, the alerts and Claude's daily watcher. */
export interface HealthRecord {
  checkedAt: string;
  /** Google's clicks are judged from this day on. */
  from: string;
  scriptVersion: number;
  traffic: GoogleHealth["traffic"];
  problems: Array<HealthProblem & { _key: string; since: string }>;
  /** Fixes handed to the Google script on this run. */
  fixes: Array<{ _key: string; id: string; op: GoogleFix["op"]; resource: string; what: string }>;
  /** Stopped by the check until a person (Claude, or Niko) clears it: unset `googleHold` on this document. */
  hold: { since: string; reason: string } | null;
}

export type StoredPlan = Omit<PilotPlan, "changes" | "pausedForCap" | "notes">;

export interface PilotRun {
  _id: string;
  _type: "agentRun";
  ranAt: string;
  /** What it was allowed to do on this run. */
  mode: "on" | "dry" | "paused";
  today: string;
  plan: StoredPlan | null;
  changes: PilotRunChange[];
  errors: string[];
  notes: string[];
  /** Meta's account spending limit, as last set. */
  limit?: { month: string; value: number; setAt: string } | null;
  // ---- remembered from run to run
  startedOn?: string;
  lastSplit?: { meta: number; google: number; date: string } | null;
  pausedForCap?: string[];
  lastChanged?: DayMark[];
  pausedForResults?: DayMark[];
  noPauseUntil?: DayMark[];
  googlePlan?: GooglePlan | null;
  /** The daily ads health check (adsHealthCore.ts). */
  health?: HealthRecord | null;
  /** Google's spending stopped by the health check, until someone clears this. */
  googleHold?: { since: string; reason: string } | null;
  /** Google campaigns the hold paused, switched back on when it is cleared. */
  pausedForHealth?: string[];
  /** The last changes made, newest first. */
  recent?: PilotRunChange[];
  history?: Array<{ _key: string; ranAt: string; mode: string; changes: number; errors: number; spentMtd: number; monthCap: number }>;
}

export async function readPilotRun(): Promise<PilotRun | null> {
  try {
    return (await getBuyersClient().getDocument<PilotRun>(RUN_ID)) ?? null;
  } catch {
    return null;
  }
}

export async function readPilotSwitch(): Promise<{ paused: boolean; changedAt: string | null }> {
  try {
    const doc = await getBuyersClient().getDocument<{ paused?: boolean; changedAt?: string }>(SWITCH_ID);
    return { paused: doc?.paused === true, changedAt: doc?.changedAt ?? null };
  } catch {
    return { paused: false, changedAt: null };
  }
}

export async function setPilotPaused(paused: boolean): Promise<void> {
  await getBuyersClient().createOrReplace({ _id: SWITCH_ID, _type: "agentConfig", paused, changedAt: new Date().toISOString() });
}

const marksToMap = (marks: DayMark[] | undefined) => Object.fromEntries((marks ?? []).map((m) => [m.id, m.day]));
const mapToMarks = (map: Record<string, string>): DayMark[] => Object.entries(map).map(([id, day]) => ({ _key: newKey(), id, day }));

// ---- Meta ------------------------------------------------------------------------------

interface AccountRow {
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  spend_cap?: string;
  amount_spent?: string;
}

interface BudgetRow {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
}

interface CampaignRow extends BudgetRow {
  stop_time?: string;
}

interface AdsetRow extends BudgetRow {
  campaign_id?: string;
  end_time?: string;
}

interface InsightRow {
  campaign_id?: string;
  adset_id?: string;
  spend?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const GONE = new Set(["DELETED", "ARCHIVED"]);

/** A lifetime budget, so a daily figure can be written as the total it means. */
interface Lifetime {
  totalCents: number;
  remainingCents: number;
  daysLeft: number;
}

interface MetaSide {
  today: string;
  currency: string;
  accountStatus: number | null;
  holders: Holder[];
  lifetimes: Map<string, Lifetime>;
  spentMtd: number;
}

async function gatherMeta(config: MetaConfig, nowMs: number, startFor: (today: string) => string): Promise<MetaSide> {
  const act = `act_${config.accountId}`;
  const account = await metaGraph<AccountRow>(config, "GET", act, { fields: "account_status,currency,timezone_name,spend_cap,amount_spent" });
  const today = dayIn(account.timezone_name, nowMs);
  const yesterday = shiftDay(today, -1);
  const since14 = shiftDay(today, -14);
  const fromDay = monthStart(today, startFor(today));
  const range = (since: string) => JSON.stringify({ since, until: yesterday });

  const [campaigns, adsets, byCampaign, byAdset, mtd] = await Promise.all([
    metaGraph<{ data?: CampaignRow[] }>(config, "GET", `${act}/campaigns`, {
      fields: "id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,stop_time",
      limit: "500",
    }),
    metaGraph<{ data?: AdsetRow[] }>(config, "GET", `${act}/adsets`, {
      fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,end_time",
      limit: "500",
    }),
    metaGraph<{ data?: InsightRow[] }>(config, "GET", `${act}/insights`, { level: "campaign", time_range: range(since14), fields: "campaign_id,spend,actions", limit: "500" }),
    metaGraph<{ data?: InsightRow[] }>(config, "GET", `${act}/insights`, { level: "adset", time_range: range(since14), fields: "adset_id,spend,actions", limit: "500" }),
    fromDay <= yesterday
      ? metaGraph<{ data?: InsightRow[] }>(config, "GET", `${act}/insights`, { level: "account", time_range: range(fromDay), fields: "spend" })
      : Promise.resolve({ data: [] as InsightRow[] }),
  ]);

  const stats = new Map<string, { spend: number; leads: number }>();
  for (const row of byCampaign.data ?? []) if (row.campaign_id) stats.set(row.campaign_id, { spend: num(row.spend), leads: leadsOf(row.actions).leads });
  for (const row of byAdset.data ?? []) if (row.adset_id) stats.set(row.adset_id, { spend: num(row.spend), leads: leadsOf(row.actions).leads });

  const ended = (iso?: string) => Boolean(iso && Date.parse(iso) <= nowMs);
  const daysUntil = (iso?: string) => (iso ? Math.max(1, Math.ceil((Date.parse(iso) - nowMs) / 86_400_000)) : 1);
  const holders: Holder[] = [];
  const lifetimes = new Map<string, Lifetime>();

  const budgetOf = (row: BudgetRow, end: string | undefined) => {
    if (num(row.daily_budget) > 0) return num(row.daily_budget) / 100;
    const total = num(row.lifetime_budget);
    if (total <= 0) return null;
    const life = { totalCents: total, remainingCents: num(row.budget_remaining), daysLeft: daysUntil(end) };
    lifetimes.set(row.id, life);
    return Math.round(life.remainingCents / life.daysLeft) / 100;
  };
  const add = (row: BudgetRow, level: Holder["level"], name: string, status: Holder["status"], end: string | undefined) => {
    const budget = budgetOf(row, end);
    if (budget === null) return;
    const s = stats.get(row.id) ?? { spend: 0, leads: 0 };
    holders.push({ channel: "meta", id: row.id, level, name, status, dailyBudget: budget, last14: { spend: Math.round(s.spend * 100) / 100, leads: s.leads } });
  };

  const liveSets = (adsets.data ?? []).filter((a) => !GONE.has(a.effective_status ?? a.status ?? ""));
  for (const c of campaigns.data ?? []) {
    if (GONE.has(c.effective_status ?? c.status ?? "")) continue;
    const sets = liveSets.filter((a) => a.campaign_id === c.id);
    const cbo = num(c.daily_budget) > 0 || num(c.lifetime_budget) > 0;
    if (cbo) {
      const running = sets.filter((a) => a.status === "ACTIVE" && !ended(a.end_time));
      const status = ended(c.stop_time) || (sets.length > 0 && sets.every((a) => ended(a.end_time))) ? "ended" : c.status === "ACTIVE" && running.length ? "active" : "paused";
      add(c, "campaign", c.name ?? "Unnamed campaign", status, c.stop_time);
    } else {
      for (const a of sets) {
        const status = ended(c.stop_time) || ended(a.end_time) ? "ended" : c.status === "ACTIVE" && a.status === "ACTIVE" ? "active" : "paused";
        add(a, "adset", `${c.name ?? "Campaign"}: ${a.name ?? "ad set"}`, status, a.end_time ?? c.stop_time);
      }
    }
  }

  return {
    today,
    currency: (account.currency ?? "USD").toUpperCase(),
    accountStatus: typeof account.account_status === "number" ? account.account_status : null,
    holders,
    lifetimes,
    spentMtd: Math.round((mtd.data ?? []).reduce((sum, row) => sum + num(row.spend), 0) * 100) / 100,
  };
}

/**
 * Real leads: of the lead form entries the lead responder has rated (last 30 days), the
 * share that weren't cold, per campaign and per ad set. Used to discount Meta's lead count
 * (a cheap lead that is only browsing isn't a result). Three rated entries are needed for a
 * campaign's own share; otherwise all of Facebook's; otherwise no discount.
 */
export async function realShares(nowMs: number): Promise<(holder: Holder) => number> {
  const since = new Date(nowMs - 30 * 86_400_000).toISOString();
  const rated = await getBuyersClient().fetch<Array<{ campaign?: string; adset?: string; temperature?: string }>>(
    `*[_type == "lead" && defined(metaCampaignId) && metaCampaignId != "" && defined(replyDraft.temperature) && _createdAt > $since]{ "campaign": metaCampaignId, "adset": metaAdsetId, "temperature": replyDraft.temperature }`,
    { since }
  );
  const shareOf = (list: typeof rated) => (list.length >= 3 ? Math.max(0.1, list.filter((l) => l.temperature !== "cold").length / list.length) : null);
  const overall = shareOf(rated) ?? 1;
  return (holder) => shareOf(rated.filter((l) => (holder.level === "campaign" ? l.campaign === holder.id : l.adset === holder.id))) ?? overall;
}

/**
 * Meta's own spending limit for the month: what counts as spent is reset, and the limit set to
 * what is left of the month's budget. Meta won't take a limit below what the account has
 * already spent, so an account without one first gets a roomy limit, which can then be reset.
 * Every step leaves room to spend, so the adverts never stop by surprise. Checked afterwards;
 * if it still isn't safe, the limit is taken off rather than stop every advert.
 */
async function setMonthLimit(config: MetaConfig, value: number): Promise<{ ok: true; value: number } | { ok: false; error: string; permission: boolean }> {
  const act = `act_${config.accountId}`;
  // Meta gives both in cents, and takes a new limit in dollars.
  const read = () => metaGraph<AccountRow>(config, "GET", act, { fields: "spend_cap,amount_spent" });
  const dollars = Math.max(MIN_DAILY, Math.round(value * 100) / 100);
  try {
    const before = await read();
    if (num(before.spend_cap) <= 0) {
      const roomy = Math.ceil((num(before.amount_spent) / 100) * 1.1 + dollars) + 1;
      await metaGraph(config, "POST", act, { spend_cap: roomy.toFixed(2) });
    }
    await metaGraph(config, "POST", act, { spend_cap_action: "reset" });
    await metaGraph(config, "POST", act, { spend_cap: dollars.toFixed(2) });
    const after = await read();
    const room = (num(after.spend_cap) - num(after.amount_spent)) / 100;
    if (room < Math.min(dollars, 1)) {
      await metaGraph(config, "POST", act, { spend_cap_action: "delete" }).catch(() => undefined);
      return { ok: false, permission: false, error: "Meta's account spending limit could not be set safely (the adverts would have stopped), so it was taken off again." };
    }
    if (Math.abs(num(after.spend_cap) - dollars * 100) > 1) {
      return { ok: false, permission: false, error: `Meta's account spending limit reads ${usd(num(after.spend_cap) / 100)} instead of ${usd(dollars)}.` };
    }
    return { ok: true, value: dollars };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meta refused it";
    return { ok: false, permission: error instanceof MetaError && error.permission, error: `Meta's account spending limit couldn't be set: ${message}` };
  }
}

async function applyMeta(config: MetaConfig, change: PilotChange, lifetime: Lifetime | undefined): Promise<void> {
  let params: Record<string, string>;
  if (change.kind === "pause") params = { status: "PAUSED" };
  else if (change.kind === "enable") params = { status: "ACTIVE" };
  else {
    const target = change.toBudget ?? MIN_DAILY;
    // A lifetime budget: what has been spent, plus the new daily figure for each day left.
    params = lifetime
      ? { lifetime_budget: String(Math.round(lifetime.totalCents - lifetime.remainingCents + target * 100 * lifetime.daysLeft)) }
      : { daily_budget: String(Math.round(target * 100)) };
  }
  await metaGraph(config, "POST", change.id, params);
}

// ---- Google --------------------------------------------------------------------------

interface GoogleSide {
  connected: boolean;
  /** A version 2 script sends the campaigns and makes the changes. */
  managed: boolean;
  canSpend: boolean;
  holders: Holder[];
  spentMtd: number;
  notes: string[];
  /** The script's last report, for the health check. */
  report: StoredGoogleReport | null;
}

async function gatherGoogle(today: string, fromDay: string, nowMs: number, adContacts: number): Promise<GoogleSide> {
  const connected = (process.env.GOOGLE_ADS_REPORT_SECRET ?? "").trim().length >= 16;
  const empty: GoogleSide = { connected, managed: false, canSpend: false, holders: [], spentMtd: 0, notes: [], report: null };
  if (!connected) return empty;
  const report = await readGoogleReport();
  if (report.error) return { ...empty, notes: [`The Google figures couldn't be read (${report.error}).`] };

  const yesterday = shiftDay(today, -1);
  const since14 = shiftDay(today, -14);
  const currency = report.rows[0]?.currency ?? "USD";
  if (currency !== "USD") return { ...empty, notes: [`The Google Ads account works in ${currency}; the autopilot only works in US dollars, so Google is left alone.`] };

  const spentMtd = Math.round(report.rows.filter((r) => r.day >= fromDay && r.day <= yesterday).reduce((s, r) => s + r.spend, 0) * 100) / 100;
  const fresh = report.receivedAt !== null && nowMs - Date.parse(report.receivedAt) <= GOOGLE_FRESH_HOURS * 3_600_000;
  const spentLately = report.rows.some((r) => r.day >= shiftDay(today, -3) && r.day <= yesterday && r.spend > 0);
  // Only a version 2 script, reporting, makes changes. Without it Google's spend still counts toward the
  // month, but Google gets no share to plan with: Facebook's budgets take up the slack.
  const managed = report.version >= 2 && fresh && !report.snapshotError;
  const notes: string[] = [];
  if (!fresh && report.rows.some((r) => r.spend > 0)) notes.push("The Google Ads script hasn't reported for more than a day: Google's latest spend may be missing.");

  const holders: Holder[] = [];
  if (managed) {
    const recent = report.rows.filter((r) => r.day >= since14 && r.day <= yesterday);
    const conversions = recent.reduce((s, r) => s + (r.conversions ?? 0), 0);
    const spend14 = recent.reduce((s, r) => s + r.spend, 0);
    // Website enquiries from Google adverts count too, when Google's own conversions miss them.
    const extra = Math.max(0, adContacts - conversions);
    for (const c of report.campaigns) {
      if (c.status !== "ENABLED" && c.status !== "PAUSED") continue;
      if (c.shared || c.dailyBudget === null) {
        if (c.status === "ENABLED") notes.push(`Google campaign "${c.name}" shares its budget with others, so the autopilot leaves it alone.`);
        continue;
      }
      const mine = recent.filter((r) => r.campaignId === c.id);
      const spend = mine.reduce((s, r) => s + r.spend, 0);
      const leads = mine.reduce((s, r) => s + (r.conversions ?? 0), 0) + (spend14 > 0 ? (extra * spend) / spend14 : 0);
      holders.push({
        channel: "google",
        id: c.id,
        level: "campaign",
        name: c.name || `Google campaign ${c.id}`,
        status: c.servingStatus === "ENDED" ? "ended" : c.status === "ENABLED" ? "active" : "paused",
        dailyBudget: c.dailyBudget,
        last14: { spend: Math.round(spend * 100) / 100, leads },
      });
    }
  } else if (spentLately) {
    notes.push("Google is spending, but its budgets can't be changed until the new Google Ads script is pasted in (Connect page): its spend still counts toward the month.");
  }
  return { connected, managed, canSpend: managed && spentLately, holders, spentMtd, notes, report };
}

/**
 * Visitors from Google adverts in the last 14 days, from the site's own visit record: how many got in touch (website
 * enquiries Google's own conversions may miss), and how many arrived each day (the health check's count of the clicks
 * that reached the website).
 */
async function googleAdVisits(today: string): Promise<{ contacts: number; arrivals: Record<string, number> }> {
  try {
    const days = Array.from({ length: 15 }, (_, i) => shiftDay(today, i - 15));
    const logs = await readVisitLogs(days);
    const stories = buildStories(logs.visits, logs.events, { from: `${days[1]}T00:00:00.000Z`, to: `${today}T00:00:00.000Z` });
    const fromGoogle = stories.filter((s) => s.sourceKind === "google_ad");
    const arrivals: Record<string, number> = {};
    for (const s of fromGoogle) arrivals[s.firstAt.slice(0, 10)] = (arrivals[s.firstAt.slice(0, 10)] ?? 0) + 1;
    return { contacts: fromGoogle.filter((s) => s.contacted).length, arrivals };
  } catch {
    return { contacts: 0, arrivals: {} };
  }
}

/** The health check's view of Google today (see adsHealthCore.ts), and the day it judges clicks from. */
async function googleHealthNow(args: {
  today: string;
  google: GoogleSide;
  previous: PilotRun | null;
  arrivals: Record<string, number>;
}): Promise<{ health: GoogleHealth; from: string } | null> {
  const { today, google, previous } = args;
  const report = google.report;
  if (!google.connected || !report) return null;
  let from = previous?.health?.from ?? HEALTH_FROM;
  // Pins the script took off explain the clicks before: judge from the day after.
  const applied = report.lastApplied;
  if (applied && applied.items.some((a) => a.id.startsWith("p") && a.did === "removed")) {
    const next = shiftDay(applied.at.slice(0, 10), 1);
    if (next > from) from = next;
  }
  // Google switched back on after a hold: judge from then, not from the days that caused it.
  if (!previous?.googleHold && (previous?.pausedForHealth?.length ?? 0) > 0 && today > from) from = today;
  const pack = await loadFactPack();
  const v3 = report.health;
  return {
    from,
    health: checkGoogleHealth({
      today,
      rows: report.rows.filter((r) => r.day >= from),
      arrivals: Object.fromEntries(Object.entries(args.arrivals).filter(([day]) => day >= from)),
      // The script's click types cover the last 7 days whole: usable once all of them are being judged.
      clickTypes: v3 && from <= shiftDay(today, -7) ? v3.clickTypes : null,
      links: v3?.links ?? null,
      ads: v3?.ads ?? null,
      prices: allowedAmounts(pack),
      soldOut: soldOutWords(pack),
      liveCampaigns: new Set(report.campaigns.filter((c) => c.status === "ENABLED" || c.status === "PAUSED").map((c) => c.id)),
    }),
  };
}

/** A short, stable name for a fix, which the Google script hands back with what it did. Pin fixes start with "p". */
function fixId(fix: GoogleFix): string {
  let h = 0;
  for (const ch of fix.key) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `${fix.key.startsWith("pin:") ? "p" : "f"}${(h >>> 0).toString(36)}`;
}

// ---- the run ---------------------------------------------------------------------------

function carried(previous: PilotRun | null): Partial<PilotRun> {
  if (!previous) return {};
  const { startedOn, lastSplit, pausedForCap, lastChanged, pausedForResults, noPauseUntil, googlePlan, recent, history, limit, health, googleHold, pausedForHealth } = previous;
  return { startedOn, lastSplit, pausedForCap, lastChanged, pausedForResults, noPauseUntil, googlePlan, recent, history, limit, health, googleHold, pausedForHealth };
}

/**
 * One run: read, decide, change (when allowed), and keep the record. `nowMs` is for tests.
 * Never throws.
 */
export async function runAdsPilot(opts: { nowMs?: number } = {}): Promise<PilotRun | { error: string }> {
  const settings = pilotSettings();
  if (settings.mode === "off") return { error: "The ads autopilot is switched off (ADS_PILOT=off)." };
  const nowMs = opts.nowMs ?? Date.now();
  const ranAt = new Date(nowMs).toISOString();
  try {
    const buyers = getBuyersClient();
    const [previous, toggle] = await Promise.all([readPilotRun(), readPilotSwitch()]);
    const mode: PilotRun["mode"] = settings.mode === "dry" ? "dry" : toggle.paused ? "paused" : "on";
    const errors: string[] = [];
    const startFor = (today: string) => settings.startDate ?? previous?.startedOn ?? today;

    const saveFailed = async (today: string, message: string) => {
      const run: PilotRun = { ...carried(previous), _id: RUN_ID, _type: "agentRun", ranAt, mode, today, plan: null, changes: [], errors: [message], notes: [] };
      run.history = [
        ...(previous?.history ?? []),
        { _key: newKey(), ranAt, mode, changes: 0, errors: 1, spentMtd: 0, monthCap: settings.monthlyCap },
      ].slice(-60);
      await buyers.createOrReplace(run);
      return run;
    };

    // Facebook / Instagram is where nearly all the money goes: without its figures, nothing changes.
    const config = metaConfig();
    if (!config) return await saveFailed(new Date(nowMs).toISOString().slice(0, 10), "Meta's ad numbers aren't connected (META_ADS_ACCESS_TOKEN), so the autopilot can't see or change anything.");
    let meta: MetaSide;
    try {
      meta = await gatherMeta(config, nowMs, startFor);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta could not be reached";
      return await saveFailed(new Date(nowMs).toISOString().slice(0, 10), `Meta's figures couldn't be read, so nothing was changed: ${message}`);
    }
    const today = meta.today;
    if (meta.currency !== "USD") return await saveFailed(today, `The Meta ad account works in ${meta.currency}; the autopilot only works in US dollars, so nothing was changed.`);
    const startDate = startFor(today);
    const fromDay = monthStart(today, startDate);

    const visits = await googleAdVisits(today);
    const [google, share] = await Promise.all([gatherGoogle(today, fromDay, nowMs, visits.contacts), realShares(nowMs)]);
    const notes: string[] = [...google.notes];

    // The daily ads health check: map pins, where Google's clicks went, the adverts' words (adsHealthCore.ts).
    const healthRun = await googleHealthNow({ today, google, previous, arrivals: visits.arrivals }).catch((error: Error) => {
      errors.push(`The ads health check couldn't run: ${error.message}`);
      return null;
    });
    const health = healthRun?.health ?? null;
    // A hold stays until someone clears it (unset googleHold on agentRun.adsPilot): Claude, once the cause is found.
    let googleHold = previous?.googleHold ?? null;
    if (!googleHold && health?.hold) googleHold = { since: today, reason: health.hold.reason };
    if (googleHold) notes.push(`Google's spending is stopped by the ads health check since ${longDate(googleHold.since)}: ${googleHold.reason}`);

    // Meta counts every form entry; only the ones that aren't cold are results.
    const metaHolders = meta.holders.map((h) => ({ ...h, last14: { ...h.last14, leads: Math.round(h.last14.leads * share(h) * 100) / 100 } }));
    const holders = [...metaHolders, ...google.holders];
    const byId = new Map(holders.map((h) => [h.id, h]));

    // What it remembers. Something Niko switched back on after the autopilot paused it for
    // its results is left running for two weeks.
    const lastChanged = marksToMap(previous?.lastChanged);
    const pausedForResults = marksToMap(previous?.pausedForResults);
    const noPauseUntil = Object.fromEntries(Object.entries(marksToMap(previous?.noPauseUntil)).filter(([, day]) => day > today));
    for (const [id] of Object.entries(pausedForResults)) {
      const h = byId.get(id);
      if (!h || h.status === "ended") delete pausedForResults[id];
      else if (h.status === "active") {
        delete pausedForResults[id];
        noPauseUntil[id] = shiftDay(today, 14);
        notes.push(`${h.name} was switched back on after the autopilot paused it, so it won't be paused for its results before ${longDate(noPauseUntil[id])}.`);
      }
    }
    const pausedForCapBefore = (previous?.pausedForCap ?? []).filter((id) => byId.get(id)?.status === "paused");

    const plan = planPilot({
      today,
      monthlyCap: settings.monthlyCap,
      startDate,
      holders,
      spentMtd: { meta: meta.spentMtd, google: google.spentMtd },
      canSpend: { meta: meta.accountStatus === 1, google: google.canSpend && !googleHold },
      lastSplit: previous?.lastSplit ?? null,
      pausedForCap: pausedForCapBefore,
      lastChanged,
      noPauseUntil,
    });
    notes.push(...plan.notes);

    // The hold pauses Google's campaigns (not just holds them at the minimum) and switches them back on once cleared.
    const pausedForHealthBefore = previous?.pausedForHealth ?? [];
    if (googleHold) {
      plan.changes = plan.changes.filter((c) => c.channel !== "google");
      for (const h of google.holders.filter((x) => x.status === "active")) {
        plan.changes.push({ channel: "google", id: h.id, level: h.level, name: h.name, kind: "pause", fromBudget: null, toBudget: null, cause: "health", reason: `The ads health check stopped Google: ${googleHold.reason}` });
      }
    } else {
      for (const h of google.holders.filter((x) => x.status === "paused" && pausedForHealthBefore.includes(x.id))) {
        plan.changes.push({ channel: "google", id: h.id, level: h.level, name: h.name, kind: "enable", fromBudget: null, toBudget: null, cause: "health", reason: "The ads health check was cleared, so Google is switched back on." });
      }
    }
    if (meta.accountStatus !== null && meta.accountStatus !== 1) notes.push("The Meta ad account can't run adverts at the moment (see the daily ads check), so its budgets are left as they are.");

    // ---- make the changes
    const changes: PilotRunChange[] = [];
    let limit = previous?.limit ?? null;
    let googlePlan: GooglePlan | null = previous?.googlePlan ?? null;
    let metaBlocked: string | null = null;
    // The month's spending limit is renewed even while paused: last month's would stop the adverts.
    const month = today.slice(0, 7);
    if (mode !== "dry" && (!limit || limit.month !== month)) {
      const set = await setMonthLimit(config, plan.remaining);
      if (set.ok) limit = { month, value: set.value, setAt: new Date().toISOString() };
      else if (set.permission) metaBlocked = "Meta doesn't allow the website's key to change the ad account. The key needs the ads_management permission.";
      else errors.push(set.error);
    }
    if (mode === "on") {
      // Pauses first, then budgets down, then up, then switching back on: never more running than planned.
      const rank = (c: PilotChange) => (c.kind === "pause" ? 0 : c.kind === "budget" && (c.toBudget ?? 0) < (c.fromBudget ?? 0) ? 1 : c.kind === "budget" ? 2 : 3);
      for (const change of [...plan.changes].sort((a, b) => rank(a) - rank(b))) {
        const entry = { ...change, _key: newKey(), day: today };
        if (change.channel === "google") {
          changes.push(google.managed ? { ...entry, done: "queued" } : { ...entry, done: "not", error: "The Google Ads script that makes changes isn't in place yet." });
          continue;
        }
        if (metaBlocked) {
          changes.push({ ...entry, done: "not", error: metaBlocked });
          continue;
        }
        try {
          await applyMeta(config, change, meta.lifetimes.get(change.id));
          changes.push({ ...entry, done: "made" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Meta refused the change.";
          if (error instanceof MetaError && error.permission) {
            metaBlocked = `Meta doesn't allow the website's key to change adverts (${message}). The key needs the ads_management permission.`;
          }
          changes.push({ ...entry, done: "not", error: metaBlocked ?? message });
        }
      }
      for (const c of changes) if (c.done === "not" && c.error && c.channel === "meta" && c.error !== metaBlocked) errors.push(`${c.name}: ${c.error}`);

      // The Google script collects its share within the hour, and the health check's fixes with it.
      const forGoogle = changes.filter((c) => c.channel === "google" && c.done === "queued");
      const fixes = google.managed ? (health?.fixes ?? []).map((f) => ({ _key: newKey(), id: fixId(f), op: f.op, resource: f.resource, what: f.what })) : [];
      const issued = new Date(nowMs);
      googlePlan =
        forGoogle.length || fixes.length
          ? {
              issuedAt: issued.toISOString(),
              validUntil: new Date(nowMs + GOOGLE_PLAN_MINUTES * 60_000).toISOString(),
              maxDaily: Math.min(100, Math.ceil(Math.max(MIN_DAILY, ...forGoogle.map((c) => c.toBudget ?? 0)))),
              campaigns: forGoogle.map((c) => ({
                _key: newKey(),
                id: c.id,
                name: c.name,
                ...(c.kind === "budget" && c.toBudget !== null && { dailyBudget: c.toBudget }),
                ...(c.kind === "pause" && { status: "PAUSED" as const }),
                ...(c.kind === "enable" && { status: "ENABLED" as const }),
              })),
              ...(fixes.length > 0 && { fixes }),
            }
          : null;

      // Remember what was done.
      for (const c of changes) {
        if (c.done === "not") continue;
        if (c.kind === "budget") lastChanged[c.id] = today;
        if (c.kind === "pause" && c.cause === "results") pausedForResults[c.id] = today;
      }
    } else {
      for (const change of plan.changes) changes.push({ ...change, _key: newKey(), day: today, done: "not" });
    }
    if (metaBlocked && !errors.includes(metaBlocked)) errors.unshift(metaBlocked);

    const done = changes.filter((c) => c.done !== "not");
    const pausedForCap =
      mode === "on"
        ? [
            ...new Set([
              ...pausedForCapBefore.filter((id) => !done.some((c) => c.id === id && c.kind === "enable")),
              ...done.filter((c) => c.kind === "pause" && c.cause === "cap").map((c) => c.id),
            ]),
          ]
        : pausedForCapBefore;
    const pausedForHealth =
      mode === "on"
        ? googleHold
          ? [...new Set([...pausedForHealthBefore, ...done.filter((c) => c.kind === "pause" && c.cause === "health").map((c) => c.id)])]
          : pausedForHealthBefore.filter((id) => !done.some((c) => c.id === id && c.kind === "enable"))
        : pausedForHealthBefore;

    // The health check's record, and one alert for what is new (a problem is told once, not every morning).
    let healthRecord: HealthRecord | null = previous?.health ?? null;
    if (health && healthRun) {
      const before = new Map((previous?.health?.problems ?? []).map((p) => [p.key, p.since]));
      const problems = health.problems.map((p) => ({ ...p, _key: newKey(), since: before.get(p.key) ?? today }));
      const fresh = problems.filter((p) => !before.has(p.key));
      const newHold = Boolean(googleHold && !previous?.googleHold);
      healthRecord = {
        checkedAt: ranAt,
        from: healthRun.from,
        scriptVersion: google.report?.version ?? 0,
        traffic: health.traffic,
        problems,
        fixes: mode === "on" ? (googlePlan?.fixes ?? []) : [],
        hold: googleHold,
      };
      if (fresh.length || newHold) {
        const how = (p: HealthProblem) =>
          p.fix === "agent"
            ? mode === "on"
              ? "Being fixed automatically: the Google Ads script does it within the hour."
              : "It would be fixed automatically, but the autopilot isn't making changes (paused or a trial run)."
            : p.fix === "claude"
              ? "Claude looks at it this morning and puts it right."
              : "This one needs you.";
        await notifyOwner({
          kind: "ads",
          urgent: newHold || fresh.some((p) => p.level === "act"),
          title: newHold ? "Google ads stopped: paid clicks aren't reaching the website" : fresh.length === 1 ? fresh[0].title : `The daily ads check found ${fresh.length} things`,
          lines: [
            ...fresh.flatMap((p) => [`• ${p.title}`, p.detail, how(p)]),
            ...(newHold && googleHold ? [`Google's adverts are paused until the cause is found: ${googleHold.reason}`] : []),
          ],
          links: [{ label: "Open the dashboard", url: "/admin/dashboard" }],
        });
      }
    }

    const stored: StoredPlan = {
      monthCap: plan.monthCap,
      spentMtd: plan.spentMtd,
      remaining: plan.remaining,
      daysLeft: plan.daysLeft,
      dailyTarget: plan.dailyTarget,
      split: plan.split,
      splitDate: plan.splitDate,
      allowance: plan.allowance,
    };

    const run: PilotRun = {
      _id: RUN_ID,
      _type: "agentRun",
      ranAt,
      mode,
      today,
      plan: stored,
      changes,
      errors,
      notes,
      limit,
      startedOn: previous?.startedOn ?? (mode === "on" ? startDate : undefined),
      lastSplit: mode === "on" ? { ...plan.split, date: plan.splitDate } : (previous?.lastSplit ?? null),
      pausedForCap,
      lastChanged: mapToMarks(Object.fromEntries(Object.entries(lastChanged).filter(([, day]) => day >= shiftDay(today, -30)))),
      pausedForResults: mapToMarks(pausedForResults),
      noPauseUntil: mapToMarks(noPauseUntil),
      googlePlan,
      health: healthRecord,
      googleHold,
      pausedForHealth,
      recent: [...done, ...(previous?.recent ?? [])].slice(0, 40),
      history: [
        ...(previous?.history ?? []),
        { _key: newKey(), ranAt, mode, changes: done.length, errors: errors.length, spentMtd: plan.spentMtd, monthCap: plan.monthCap },
      ].slice(-60),
    };
    if (run.startedOn === undefined) delete run.startedOn;
    await buyers.createOrReplace(run);
    return run;
  } catch (error) {
    console.error("[ads autopilot] failed:", error);
    return { error: error instanceof Error ? error.message : "The ads autopilot could not run." };
  }
}

/** What the Google script should do now: the changes still within their time, or nothing. */
export async function googlePlanNow(nowMs = Date.now()): Promise<{ mode: string; plan: GooglePlan | null }> {
  const settings = pilotSettings();
  if (settings.mode !== "on") return { mode: settings.mode, plan: null };
  const [run, toggle] = await Promise.all([readPilotRun(), readPilotSwitch()]);
  if (toggle.paused) return { mode: "paused", plan: null };
  const plan = run?.googlePlan ?? null;
  if (!plan || Date.parse(plan.validUntil) < nowMs) return { mode: "on", plan: null };
  return { mode: "on", plan };
}
