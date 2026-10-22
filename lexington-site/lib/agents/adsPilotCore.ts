/**
 * The ads autopilot's decisions, without the plumbing: given what each campaign spent
 * and brought in, how much may be spent today so the month stays within the budget,
 * how it is split between Facebook / Instagram and Google, and which budgets to change
 * or adverts to pause. Pure, so every rule can be tested on its own;
 * lib/agents/adsPilot.ts reads the numbers and makes the changes.
 *
 * THE RULES (Niko, 22 Oct 2026: "keeps it to a budget of $200 a month", fully automatic,
 * results decide the split, Meta's own spending limit as a safety net):
 * - The month's budget is paced: today's allowance is what is left divided by the days left
 *   (never more than 2.5 times an average day). The first month counts from the day the
 *   autopilot started, pro rata.
 * - Results decide the split: weekly, at most 25 points move toward the channel whose leads
 *   cost less, and each running channel keeps at least 20%. A channel that cannot spend
 *   (Google paused for a payment) gets nothing; its campaigns wait at $1 a day.
 * - Inside a channel, money follows real leads per dollar (the plumbing discounts leads the
 *   lead responder rated cold). A campaign that spent twice the channel's cost per lead (at
 *   least $10) over 14 days without a real lead is paused, as long as something else in that
 *   channel is bringing them, and never again within 14 days of Niko switching it back on.
 * - A budget only changes when it moves by at least 10% (and 50 cents), and only goes up
 *   three days after its last change: steady budgets let Meta and Google learn.
 * - When the month's money is used up, everything is paused until the 1st, and the same
 *   campaigns are switched back on then.
 */

export type Channel = "meta" | "google";

export interface Holder {
  channel: Channel;
  /** The campaign or ad set that holds the budget. */
  id: string;
  level: "campaign" | "adset";
  name: string;
  /** "active" can spend; "paused" was switched off; "ended" passed its end date. */
  status: "active" | "paused" | "ended";
  /** US dollars a day (for a lifetime budget: what is left of it per day left). */
  dailyBudget: number;
  /** The last 14 complete days. `leads` counts real leads and may be fractional. */
  last14: { spend: number; leads: number };
}

export interface PilotInput {
  /** YYYY-MM-DD, the ad account's day. */
  today: string;
  monthlyCap: number;
  /** The day the autopilot started: the first month is pro rata from it. */
  startDate: string;
  holders: Holder[];
  /** Spend so far this month (from the start date in the first month), complete days. */
  spentMtd: { meta: number; google: number };
  canSpend: { meta: boolean; google: boolean };
  /** Where the split stood, and the day it was last set. */
  lastSplit: { meta: number; google: number; date: string } | null;
  /** Holders the autopilot paused because the month's money ran out (to switch back on). */
  pausedForCap: string[];
  /** The day the autopilot last changed each holder's budget. */
  lastChanged: Record<string, string>;
  /** Holders Niko switched back on after the autopilot paused them: not paused again before this day. */
  noPauseUntil: Record<string, string>;
}

export interface PilotChange {
  channel: Channel;
  id: string;
  level: "campaign" | "adset";
  name: string;
  kind: "budget" | "pause" | "enable";
  /** For a budget, dollars a day; for the others, null. */
  fromBudget: number | null;
  toBudget: number | null;
  /** Why it paused: the month's money ran out, or the results. */
  cause: "cap" | "results" | "pace" | "idle" | "month";
  reason: string;
}

export interface PilotPlan {
  monthCap: number;
  spentMtd: number;
  remaining: number;
  daysLeft: number;
  dailyTarget: number;
  split: { meta: number; google: number };
  splitDate: string;
  /** What each channel may spend today. */
  allowance: { meta: number; google: number };
  changes: PilotChange[];
  /** Holders paused because the month's money ran out. */
  pausedForCap: string[];
  notes: string[];
}

export type PilotMode = "on" | "dry" | "off";

export interface PilotSettings {
  monthlyCap: number;
  mode: PilotMode;
  /** ADS_PILOT_START, when set: the day the first month is counted from. */
  startDate: string | null;
}

/** ADS_MONTHLY_BUDGET (default 200), ADS_PILOT (on, dry or off; dry anywhere but the live site), ADS_PILOT_START. */
export function pilotSettings(env: Record<string, string | undefined> = process.env): PilotSettings {
  const cap = Number(env.ADS_MONTHLY_BUDGET);
  const monthlyCap = Number.isFinite(cap) && cap >= 20 && cap <= 5000 ? Math.round(cap * 100) / 100 : 200;
  const flag = (env.ADS_PILOT ?? "").trim().toLowerCase();
  const mode: PilotMode = flag === "off" ? "off" : flag === "dry" ? "dry" : flag === "on" || env.VERCEL_ENV === "production" ? "on" : "dry";
  const start = (env.ADS_PILOT_START ?? "").trim();
  return { monthlyCap, mode, startDate: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null };
}

/** The ad account's own day (Meta's budgets and figures run on it). */
export function dayIn(timezone: string | undefined, nowMs: number): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

export const MIN_DAILY = 1;
const MIN_SHARE = 0.2;
const MAX_WEEKLY_SHIFT = 0.25;
const MAX_DAY_FACTOR = 2.5;
const RAISE_AFTER_DAYS = 3;
export const CHANNEL_NAMES: Record<Channel, string> = { meta: "Facebook / Instagram", google: "Google" };

export const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "")}`;
const cents = (n: number) => Math.round(n * 100) / 100;
// Down to the 10 cents, so the budgets never add up to more than the day allows.
const round10c = (n: number) => Math.floor(n * 10 + 1e-9) / 10;

export function daysInMonth(day: string): number {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dayOfMonth(day: string): number {
  return Number(day.slice(8, 10));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The first day this month's spend counts from: the 1st, or the start day in the first month. */
export function monthStart(today: string, startDate: string): string {
  return today.slice(0, 7) === startDate.slice(0, 7) ? startDate : `${today.slice(0, 7)}-01`;
}

/** This month's budget: the full amount, or the share left when the autopilot started mid-month. */
export function monthCapFor(today: string, startDate: string, monthlyCap: number): number {
  if (today.slice(0, 7) !== startDate.slice(0, 7)) return monthlyCap;
  const total = daysInMonth(today);
  const covered = total - dayOfMonth(startDate) + 1;
  return cents((monthlyCap * covered) / total);
}

/** Leads per dollar, smoothed so one lucky lead doesn't decide everything. */
const yieldOf = (spend: number, leads: number) => (leads + 0.5) / (spend + 5);

/** The week's split between the channels. */
export function chooseSplit(input: PilotInput, notes: string[]): { meta: number; google: number; date: string } {
  const { canSpend, today, lastSplit } = input;
  if (canSpend.meta && !canSpend.google) return { meta: 1, google: 0, date: today };
  if (canSpend.google && !canSpend.meta) return { meta: 0, google: 1, date: today };
  if (!canSpend.meta && !canSpend.google) return { meta: 0, google: 0, date: today };

  // Both can spend: start even, then move weekly toward the cheaper real leads.
  const both = lastSplit && lastSplit.meta > 0 && lastSplit.google > 0 ? lastSplit : null;
  const base = both ?? { meta: 0.5, google: 0.5, date: today };
  if (both && daysBetween(both.date, today) < 7) return both;

  const sum = (ch: Channel) =>
    input.holders
      .filter((h) => h.channel === ch)
      .reduce((acc, h) => ({ spend: acc.spend + h.last14.spend, leads: acc.leads + h.last14.leads }), { spend: 0, leads: 0 });
  const meta = sum("meta");
  const google = sum("google");
  if (meta.leads + google.leads < 3) {
    if (both) notes.push("Too few leads yet to judge Facebook against Google: the split stays as it was.");
    return { meta: base.meta, google: base.google, date: today };
  }
  const ym = yieldOf(meta.spend, meta.leads);
  const yg = yieldOf(google.spend, google.leads);
  const better: Channel = ym >= yg ? "meta" : "google";
  const ratio = Math.min(ym, yg) / Math.max(ym, yg); // 1 = equal
  const shift = Math.min(MAX_WEEKLY_SHIFT, (1 - ratio) / 2);
  let m = base.meta + (better === "meta" ? shift : -shift);
  m = Math.round(Math.max(MIN_SHARE, Math.min(1 - MIN_SHARE, m)) * 100) / 100;
  if (Math.abs(m - base.meta) >= 0.01) {
    notes.push(
      `${CHANNEL_NAMES[better]} brought cheaper leads over 14 days: the split moves to ${Math.round(m * 100)}% Facebook / ${Math.round((1 - m) * 100)}% Google.`
    );
  }
  return { meta: m, google: Math.round((1 - m) * 100) / 100, date: today };
}

export function planPilot(input: PilotInput): PilotPlan {
  const notes: string[] = [];
  const changes: PilotChange[] = [];
  const monthCap = monthCapFor(input.today, input.startDate, input.monthlyCap);
  const spentMtd = cents(input.spentMtd.meta + input.spentMtd.google);
  const remaining = Math.max(0, cents(monthCap - spentMtd));
  const daysLeft = daysInMonth(input.today) - dayOfMonth(input.today) + 1;
  const coveredDays = daysLeft + daysBetween(monthStart(input.today, input.startDate), input.today);
  const ceiling = (monthCap / Math.max(1, coveredDays)) * MAX_DAY_FACTOR;
  const dailyTarget = Math.floor(Math.min(remaining / daysLeft, ceiling) * 100) / 100;
  const live = input.holders.filter((h) => h.status !== "ended");
  const base = { monthCap, spentMtd, remaining, daysLeft };

  // ---- the month's money is used up: pause everything still running
  if (remaining < MIN_DAILY) {
    const pausing = live.filter((h) => h.status === "active");
    for (const h of pausing) {
      changes.push({
        channel: h.channel,
        id: h.id,
        level: h.level,
        name: h.name,
        kind: "pause",
        fromBudget: null,
        toBudget: null,
        cause: "cap",
        reason: `This month's ${usd(monthCap)} is spent; it restarts on the 1st.`,
      });
    }
    if (pausing.length) notes.push(`This month's ${usd(monthCap)} is spent (${usd(spentMtd)}): every advert is paused until the 1st.`);
    return {
      ...base,
      dailyTarget: 0,
      split: input.lastSplit ? { meta: input.lastSplit.meta, google: input.lastSplit.google } : { meta: 1, google: 0 },
      splitDate: input.lastSplit?.date ?? input.today,
      allowance: { meta: 0, google: 0 },
      changes,
      pausedForCap: [...new Set([...input.pausedForCap, ...pausing.map((h) => h.id)])],
      notes,
    };
  }

  // ---- a new month: switch back on what the autopilot paused for the budget
  const reopened = new Set<string>();
  for (const h of live) {
    if (h.status === "paused" && input.pausedForCap.includes(h.id)) {
      changes.push({
        channel: h.channel,
        id: h.id,
        level: h.level,
        name: h.name,
        kind: "enable",
        fromBudget: null,
        toBudget: null,
        cause: "month",
        reason: "A new month's budget: switched back on.",
      });
      reopened.add(h.id);
    }
  }

  const split = chooseSplit(input, notes);
  const allowance = {
    meta: Math.floor(dailyTarget * split.meta * 100) / 100,
    google: Math.floor(dailyTarget * split.google * 100) / 100,
  };
  const running = (ch: Channel) => live.filter((h) => h.channel === ch && (h.status === "active" || reopened.has(h.id)));
  const mayRaise = (id: string) => !input.lastChanged[id] || daysBetween(input.lastChanged[id], input.today) >= RAISE_AFTER_DAYS;

  for (const channel of ["meta", "google"] as const) {
    const holders = running(channel);
    const channelDaily = allowance[channel];

    if (!input.canSpend[channel]) {
      // Google paused for a payment, say: hold its campaigns at the minimum, so a restart can't
      // overspend. (A Meta account that can't spend is left alone: its spending limit holds it.)
      if (channel === "google") {
        for (const h of holders) {
          if (h.dailyBudget - MIN_DAILY >= 0.01) {
            changes.push({
              channel,
              id: h.id,
              level: h.level,
              name: h.name,
              kind: "budget",
              fromBudget: h.dailyBudget,
              toBudget: MIN_DAILY,
              cause: "idle",
              reason: `Google isn't spending at the moment: held at ${usd(MIN_DAILY)} a day until it does.`,
            });
          }
        }
      }
      continue;
    }
    if (!holders.length) {
      notes.push(`No ${CHANNEL_NAMES[channel]} adverts are running, so its share of the budget (${usd(channelDaily)} a day) isn't being used.`);
      continue;
    }

    // Pause what spends without bringing real leads, while something else in the channel does.
    const spend = holders.reduce((s, h) => s + h.last14.spend, 0);
    const leads = holders.reduce((s, h) => s + h.last14.leads, 0);
    let keep = holders;
    if (leads >= 1) {
      const cpl = spend / leads;
      const limit = Math.max(10, 2 * cpl);
      const pausable = (h: Holder) => !input.noPauseUntil[h.id] || input.noPauseUntil[h.id] <= input.today;
      const weak = holders.filter((h) => h.last14.leads < 0.5 && h.last14.spend >= limit && pausable(h));
      const strong = holders.filter((h) => h.last14.leads >= 1);
      if (weak.length && strong.length) {
        for (const h of weak) {
          changes.push({
            channel,
            id: h.id,
            level: h.level,
            name: h.name,
            kind: "pause",
            fromBudget: null,
            toBudget: null,
            cause: "results",
            reason: `Spent ${usd(h.last14.spend)} in 14 days without a real lead (they cost ${usd(cpl)} elsewhere).`,
          });
        }
        keep = holders.filter((h) => !weak.includes(h));
      }
    }

    // Share the channel's day among what keeps running, by real leads per dollar, at least the minimum each.
    if (channelDaily < MIN_DAILY * keep.length) {
      notes.push(`Today's ${CHANNEL_NAMES[channel]} allowance (${usd(channelDaily)}) is below ${usd(MIN_DAILY)} a campaign: each runs at the minimum.`);
    }
    const weights = keep.map((h) => yieldOf(h.last14.spend, h.last14.leads));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    keep.forEach((h, i) => {
      const target = Math.max(MIN_DAILY, round10c((channelDaily * weights[i]) / total));
      const from = h.dailyBudget;
      const move = Math.abs(target - from);
      if (move < 0.5 || move < from * 0.1) return;
      if (target > from && !mayRaise(h.id) && !reopened.has(h.id)) return;
      changes.push({
        channel,
        id: h.id,
        level: h.level,
        name: h.name,
        kind: "budget",
        fromBudget: from,
        toBudget: target,
        cause: "pace",
        reason: `Keeps the month within ${usd(monthCap)}: ${usd(remaining)} left for ${daysLeft} day${daysLeft === 1 ? "" : "s"}, ${usd(channelDaily)} a day for ${CHANNEL_NAMES[channel]}.`,
      });
    });
  }

  return {
    ...base,
    dailyTarget,
    split: { meta: split.meta, google: split.google },
    splitDate: split.date,
    allowance,
    changes,
    pausedForCap: input.pausedForCap.filter((id) => !reopened.has(id)),
    notes,
  };
}
