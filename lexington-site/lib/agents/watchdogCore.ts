/**
 * The ads watchdog's rules: given what Meta, Google, the website's own visit record
 * and the CRM say, what needs Niko today ("act"), what to keep an eye on ("watch"),
 * and the plain numbers ("ok"). Pure, so every rule can be tested on its own;
 * lib/agents/watchdog.ts gathers the numbers, keeps the result and sends the email.
 *
 * It only ever reads and reports. Nothing here changes an advert or a budget (the ads
 * autopilot does that, and what it did and couldn't do is reported here).
 */
import { formatUSD } from "@/lib/format";

import { longDate, type OfferFact } from "./factsCore";

export type Level = "act" | "watch" | "ok";

export interface Finding {
  level: Level;
  area: "Meta" | "Google" | "Website" | "Replies" | "Offer" | "Setup" | "Autopilot";
  title: string;
  detail?: string;
}

export interface Period {
  spend: number;
  leads: number;
}

export interface MetaWatch {
  connected: true;
  /** A part that could not be read, in Meta's words. */
  error?: string;
  /** Meta's account_status: 1 is active. */
  accountStatus?: number | null;
  currency: string;
  yesterday: Period;
  last3: Period;
  last7: Period & { linkClicks: number };
  prev7: Period;
  campaigns: Array<{ name: string; status: string; stopTime: string | null; dailyBudget: number | null }>;
  problemAds: Array<{ name: string; status: string; reason?: string }>;
}

export interface GoogleWatch {
  connected: true;
  receivedAt: string | null;
  /** Spend in the last 30 days at all (an account that never ran is not "stopped"). */
  spentRecently: boolean;
  /** Whole days up to yesterday with no spend, counting back from yesterday. */
  daysWithoutSpend: number;
  last7: { spend: number; clicks: number; conversions: number | null };
  currency: string;
}

export interface PilotWatch {
  /** off: ADS_PILOT=off; dry: trial mode; paused: Niko paused it on the dashboard. */
  mode: "on" | "dry" | "paused" | "off";
  ranAt: string | null;
  errors: string[];
  monthCap: number | null;
  spentMtd: number | null;
  dailyTarget: number | null;
  /** What it changed on its last run, in words. */
  changes: string[];
}

export interface WatchInput {
  today: string;
  nowMs: number;
  meta: MetaWatch | { connected: false };
  google: GoogleWatch | { connected: false };
  site: {
    /** Visits that arrived from adverts, one entry per day, oldest first, ending yesterday. */
    days: Array<{ day: string; meta: number; google: number }>;
    last7: { adVisits: number; contacted: number };
  };
  crm: {
    /** People waiting for a first reply past its due day, oldest first. */
    waiting: Array<{ id: string; name: string; days: number }>;
    newLast7: { website: number; facebook: number; other: number };
  };
  /** The banner's offer as written (even if its last day has passed), or null. */
  offer: OfferFact | null;
  metaLeads: { configured: boolean; lastOkAt: string | null; lastError: string | null };
  pilot?: PilotWatch | null;
}

const ACCOUNT_STATUS: Record<number, string> = {
  2: "disabled",
  3: "a payment is due",
  7: "under Meta's risk review",
  8: "waiting for a payment to settle",
  9: "in a grace period (a payment is due)",
  100: "being closed",
  101: "closed",
};

const CAMPAIGN_PROBLEMS: Record<string, string> = {
  WITH_ISSUES: "has a problem",
  PENDING_BILLING_INFO: "is waiting for payment details",
  DISAPPROVED: "was rejected",
};

// "$15.60", "$36" (whole dollars stay whole).
const money = (value: number, currency: string) => {
  const cents = Math.round(value * 100) / 100;
  if (currency !== "USD") return `${cents.toFixed(2)} ${currency}`;
  return Number.isInteger(cents) ? formatUSD(cents) : `$${cents.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function checkAll(input: WatchInput): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);

  // ---- Meta ------------------------------------------------------------------
  if (input.meta.connected) {
    const m = input.meta;
    const cur = m.currency;
    if (m.accountStatus != null && m.accountStatus !== 1) {
      add({
        level: "act",
        area: "Meta",
        title: `The Meta ad account can't run ads: ${ACCOUNT_STATUS[m.accountStatus] ?? `status ${m.accountStatus}`}.`,
        detail: "Open Ads Manager > Billing and payments to see what Meta wants.",
      });
    }
    for (const c of m.campaigns) {
      const problem = CAMPAIGN_PROBLEMS[c.status];
      if (problem) add({ level: "act", area: "Meta", title: `Campaign "${c.name}" ${problem}.` });
    }
    if (m.problemAds.length) {
      add({
        level: "act",
        area: "Meta",
        title: `${plural(m.problemAds.length, "advert")} rejected or with a problem.`,
        detail: m.problemAds.map((a) => `${a.name}${a.reason ? `: ${a.reason}` : ""}`).join(" · "),
      });
    }
    const running = m.campaigns.filter((c) => c.status === "ACTIVE");
    const prevDaily = m.prev7.spend / 7;
    if (running.length && m.yesterday.spend === 0 && prevDaily >= 2) {
      add({
        level: "act",
        area: "Meta",
        title: `Meta spent nothing yesterday, although ${plural(running.length, "campaign is", "campaigns are")} on.`,
        detail: `It was about ${money(prevDaily, cur)} a day the week before. Often a payment or a spending limit.`,
      });
    }
    if (m.last3.spend >= 15 && m.last3.leads === 0) {
      add({
        level: "act",
        area: "Meta",
        title: `Meta spent ${money(m.last3.spend, cur)} in the last 3 days and brought no leads.`,
        detail: "Worth looking at the adverts and the audience before spending more.",
      });
    }
    const cpl = m.last7.leads ? m.last7.spend / m.last7.leads : null;
    const prevCpl = m.prev7.leads ? m.prev7.spend / m.prev7.leads : null;
    if (cpl != null && prevCpl != null && m.last7.leads >= 3 && cpl >= prevCpl * 1.5) {
      add({
        level: "watch",
        area: "Meta",
        title: `Each Meta lead cost ${money(cpl, cur)} this week, up from ${money(prevCpl, cur)} the week before.`,
      });
    }
    for (const c of running) {
      if (!c.stopTime) continue;
      const stopDay = c.stopTime.slice(0, 10);
      const left = daysBetween(input.today, stopDay);
      if (left >= 0 && left <= 7) {
        add({
          level: left <= 2 ? "act" : "watch",
          area: "Meta",
          title: `Campaign "${c.name}" stops on ${longDate(stopDay)}${left === 0 ? " (today)" : left === 1 ? " (tomorrow)" : ` (in ${left} days)`}.`,
          detail: "Decide whether to extend it, replace it or let it end.",
        });
      }
    }
    if (m.error) add({ level: "watch", area: "Meta", title: "Part of the Meta numbers could not be read.", detail: m.error });
    add({
      level: "ok",
      area: "Meta",
      title: `Meta, last 7 days: ${money(m.last7.spend, cur)} spent, ${plural(m.last7.leads, "lead")}${cpl != null ? ` (${money(cpl, cur)} each)` : ""}, ${plural(m.last7.linkClicks, "link click")}.`,
    });
  } else {
    add({
      level: "watch",
      area: "Setup",
      title: "Meta's ad numbers aren't connected, so this check can't see spend, rejected adverts or payment problems there.",
      detail: "The steps are on the dashboard's Connect page (the META_ADS_ACCESS_TOKEN setting).",
    });
  }

  // ---- Facebook lead forms into the CRM ----------------------------------------
  if (input.metaLeads.configured && input.metaLeads.lastError) {
    add({
      level: "watch",
      area: "Setup",
      title: "Facebook / Instagram lead form entries aren't reaching the CRM.",
      detail: input.metaLeads.lastError,
    });
  }

  // ---- Google ----------------------------------------------------------------
  if (input.google.connected) {
    const g = input.google;
    const hoursSince = g.receivedAt ? (input.nowMs - Date.parse(g.receivedAt)) / 3_600_000 : null;
    if (hoursSince == null || hoursSince > 6) {
      add({
        level: hoursSince == null || hoursSince > 24 ? "act" : "watch",
        area: "Google",
        title: g.receivedAt
          ? `The Google Ads script hasn't reported for ${Math.floor(hoursSince!)} hours.`
          : "The Google Ads script has never reported.",
        detail: "In Google Ads: Tools > Bulk actions > Scripts, check it is on and runs hourly.",
      });
    }
    if (g.spentRecently && g.daysWithoutSpend >= 2) {
      add({
        level: "act",
        area: "Google",
        title: `Google Ads has spent nothing for ${g.daysWithoutSpend} days.`,
        detail: "The account may be paused for a payment, or every campaign is off.",
      });
    }
    add({
      level: "ok",
      area: "Google",
      title: `Google, last 7 days: ${money(g.last7.spend, g.currency)} spent, ${plural(g.last7.clicks, "click")}${g.last7.conversions != null ? `, ${plural(Math.round(g.last7.conversions), "conversion")}` : ""}.`,
    });
  } else {
    add({
      level: "watch",
      area: "Setup",
      title: "Google Ads isn't connected, so this check can't see its spend.",
      detail: "The steps are on the dashboard's Connect page (a small script inside Google Ads).",
    });
  }

  // ---- the website's own record of ad visitors --------------------------------
  const days = input.site.days;
  if (days.length >= 2) {
    const yesterday = days[days.length - 1];
    const before = days.slice(0, -1);
    for (const [key, name] of [
      ["meta", "Facebook / Instagram ads"],
      ["google", "Google ads"],
    ] as const) {
      const avg = before.reduce((sum, d) => sum + d[key], 0) / before.length;
      if (avg >= 5 && yesterday[key] === 0) {
        add({
          level: "act",
          area: "Website",
          title: `No visitors came from ${name} yesterday, against about ${Math.round(avg)} a day before.`,
          detail: "The adverts have probably stopped: check the ad account.",
        });
      }
    }
  }
  add({
    level: "ok",
    area: "Website",
    title: `Website, last 7 days: ${plural(input.site.last7.adVisits, "visit")} from adverts, ${input.site.last7.contacted} of them got in touch.`,
  });

  // ---- replies ----------------------------------------------------------------
  const waiting = input.crm.waiting;
  if (waiting.length) {
    const oldest = waiting[0];
    add({
      level: "act",
      area: "Replies",
      title: `${plural(waiting.length, "enquiry is", "enquiries are")} still waiting for a first reply.`,
      detail: `Longest waiting: ${oldest.name}, ${plural(oldest.days, "day")}. Each has a suggested reply in the CRM.`,
    });
  }
  const n = input.crm.newLast7;
  add({
    level: "ok",
    area: "Replies",
    title: `New enquiries, last 7 days: ${n.website} from the website, ${n.facebook} from Facebook forms, ${n.other} other.`,
  });

  // ---- the offer ----------------------------------------------------------------
  const offer = input.offer;
  if (offer?.ended && offer.endsOn) {
    add({
      level: "act",
      area: "Offer",
      title: `The website banner still shows the offer that ended on ${longDate(offer.endsOn)}.`,
      detail: "Change or switch off the banner in Studio (Site settings), and check the adverts and posts that quote it.",
    });
  } else if (offer?.endsOn) {
    const left = daysBetween(input.today, offer.endsOn);
    if (left >= 0 && left <= 7) {
      add({
        level: "watch",
        area: "Offer",
        title: `The offer on the website ends on ${longDate(offer.endsOn)}${left === 0 ? " (today)" : left === 1 ? " (tomorrow)" : ` (in ${left} days)`}.`,
        detail: "Decide what comes next: the banner, the adverts and the posts all quote it.",
      });
    }
  }

  // ---- the ads autopilot ---------------------------------------------------------
  const pilot = input.pilot;
  if (pilot && pilot.mode !== "off") {
    const hours = pilot.ranAt ? (input.nowMs - Date.parse(pilot.ranAt)) / 3_600_000 : null;
    if (pilot.errors.length && hours != null && hours <= 30) {
      add({ level: "act", area: "Autopilot", title: "The ads autopilot couldn't do everything this morning.", detail: pilot.errors.join(" · ") });
    }
    if (pilot.mode === "on" && (hours == null || hours > 30)) {
      add({
        level: "watch",
        area: "Autopilot",
        title: pilot.ranAt ? `The ads autopilot hasn't run for ${Math.floor(hours!)} hours.` : "The ads autopilot hasn't run yet.",
        detail: "It runs every morning at 6; the dashboard's Run now runs it at once.",
      });
    }
    if (pilot.mode === "paused") {
      add({
        level: "watch",
        area: "Autopilot",
        title: "The ads autopilot is paused, so nothing is keeping the budgets to the month's limit.",
        detail: "Facebook's own monthly spending limit still stops its adverts. Resume it on the dashboard.",
      });
    }
    if (pilot.monthCap != null && pilot.spentMtd != null) {
      add({
        level: "ok",
        area: "Autopilot",
        title: `Ads autopilot: ${money(pilot.spentMtd, "USD")} of this month's ${money(pilot.monthCap, "USD")} spent${pilot.dailyTarget != null ? `, up to ${money(pilot.dailyTarget, "USD")} a day from today` : ""}.`,
        detail: pilot.changes.length ? `This morning: ${pilot.changes.join(" · ")}` : undefined,
      });
    }
  }

  const order: Record<Level, number> = { act: 0, watch: 1, ok: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Whether today's result is worth an email: anything to act on, or the Monday round-up. */
export function shouldEmail(findings: Finding[], today: string): boolean {
  const monday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
  return monday || findings.some((f) => f.level === "act");
}

export function emailSubject(findings: Finding[], today: string): string {
  const act = findings.filter((f) => f.level === "act").length;
  const monday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
  if (act) return `Ads check: ${plural(act, "thing needs", "things need")} you`;
  return monday ? "Ads check: the week, all in order" : "Ads check: all in order";
}
