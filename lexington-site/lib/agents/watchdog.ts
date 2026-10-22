import "server-only";

import { randomUUID } from "node:crypto";

import { claudeConfigured, writeWithClaude } from "@/lib/ai/claude";
import { summariseGoogle } from "@/lib/ads/google";
import { readGoogleReport } from "@/lib/ads/googleStore";
import { fetchMetaReport, metaConfig, type MetaConfig } from "@/lib/ads/meta";
import { todayISO } from "@/lib/crm";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { client } from "@/lib/sanity/client";
import type { LeadTask } from "@/lib/sanity/crmTypes";
import { SITE_URL } from "@/lib/seo";
import { sendNotice } from "@/lib/social/notify";
import { buildStories, shiftDay } from "@/lib/visits/report";
import { readVisitLogs } from "@/lib/visits/store";

import { pilotSettings, readPilotRun, readPilotSwitch } from "./adsPilot";
import { usd } from "./adsPilotCore";
import { parseOffer } from "./factsCore";
import { metaLeadsConfigured, readMetaLeadsState } from "./metaLeads";
import { checkAll, emailSubject, shouldEmail, type Finding, type MetaWatch, type PilotWatch, type WatchInput } from "./watchdogCore";

/**
 * THE ADS WATCHDOG. Every morning at 7 (Ghana time = GMT) it reads what Meta and
 * Google say the adverts did, the website's own record of ad visitors, the CRM's
 * enquiries and the offer on the website, and runs the rules in watchdogCore.ts.
 * Niko gets an email when something needs him (and a round-up every Monday); the
 * dashboard shows the latest check. It only reads: nothing changes an advert.
 */

// A test copy or a preview keeps its own record, apart from the live site's.
const RUN_ID = process.env.VERCEL_ENV === "production" ? "agentRun.watchdog" : "agentRun.watchdog-dev";
const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12);

export interface WatchdogRun {
  _id: string;
  _type: "agentRun";
  ranAt: string;
  findings: Array<Finding & { _key: string }>;
  summary?: string | null;
  emailed?: boolean;
  history?: Array<{ _key: string; ranAt: string; act: number; watch: number }>;
}

// ---- Meta -------------------------------------------------------------------

async function metaGet<T>(config: MetaConfig, path: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(`${config.base}/${config.version}/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as ({ error?: { message?: string } } & T) | null;
  if (!response.ok || body?.error) throw new Error(body?.error?.message ?? `Meta answered ${response.status}`);
  return body as T;
}

async function gatherMeta(today: string): Promise<WatchInput["meta"]> {
  const config = metaConfig();
  if (!config) return { connected: false };
  const yesterday = shiftDay(today, -1);
  const act = `act_${config.accountId}`;

  const [report, account, ads] = await Promise.all([
    fetchMetaReport(config, shiftDay(today, -14), yesterday),
    metaGet<{ account_status?: number }>(config, act, { fields: "account_status" }).catch((e: Error) => e),
    metaGet<{ data?: Array<{ name?: string; effective_status?: string; ad_review_feedback?: { global?: Record<string, string> } }> }>(
      config,
      `${act}/ads`,
      { fields: "name,effective_status,ad_review_feedback", effective_status: JSON.stringify(["DISAPPROVED", "WITH_ISSUES"]), limit: "50" }
    ).catch((e: Error) => e),
  ]);

  const errors: string[] = [];
  if (account instanceof Error) errors.push(`Account: ${account.message}`);
  if (ads instanceof Error) errors.push(`Adverts: ${ads.message}`);

  if (!report.ok) {
    return {
      connected: true,
      error: [report.error, ...errors].join(" · "),
      accountStatus: account instanceof Error ? null : (account.account_status ?? null),
      currency: "USD",
      yesterday: { spend: 0, leads: 0 },
      last3: { spend: 0, leads: 0 },
      last7: { spend: 0, leads: 0, linkClicks: 0 },
      prev7: { spend: 0, leads: 0 },
      campaigns: [],
      problemAds: [],
    };
  }

  const r = report.report;
  const sum = (from: number, to: number) => {
    const slice = r.byDay.slice(from, to);
    return {
      spend: Math.round(slice.reduce((s, d) => s + d.spend, 0) * 100) / 100,
      leads: slice.reduce((s, d) => s + d.leads, 0),
      linkClicks: slice.reduce((s, d) => s + d.linkClicks, 0),
    };
  };
  const n = r.byDay.length; // 14 days, oldest first, ending yesterday
  const last7 = sum(n - 7, n);
  const meta: MetaWatch = {
    connected: true,
    error: [...r.partial, ...errors].join(" · ") || undefined,
    accountStatus: account instanceof Error ? null : (account.account_status ?? null),
    currency: r.currency,
    yesterday: sum(n - 1, n),
    last3: sum(n - 3, n),
    last7,
    prev7: sum(0, n - 7),
    campaigns: r.campaigns.map((c) => ({ name: c.name, status: c.status, stopTime: c.stopTime, dailyBudget: c.dailyBudget })),
    problemAds:
      ads instanceof Error
        ? []
        : (ads.data ?? []).map((a) => ({
            name: a.name ?? "Unnamed advert",
            status: a.effective_status ?? "",
            reason: Object.values(a.ad_review_feedback?.global ?? {})[0],
          })),
  };
  return meta;
}

// ---- Google -------------------------------------------------------------------

async function gatherGoogle(today: string): Promise<WatchInput["google"]> {
  if ((process.env.GOOGLE_ADS_REPORT_SECRET ?? "").trim().length < 16) return { connected: false };
  const report = await readGoogleReport();
  const yesterday = shiftDay(today, -1);
  const last7Days = Array.from({ length: 7 }, (_, i) => shiftDay(yesterday, i - 6));
  const summary = summariseGoogle(report.rows, last7Days);
  let daysWithoutSpend = 0;
  for (let i = 0; i < 30; i += 1) {
    const day = shiftDay(yesterday, -i);
    const spent = report.rows.filter((row) => row.day === day).reduce((s, row) => s + row.spend, 0);
    if (spent > 0) break;
    daysWithoutSpend += 1;
  }
  return {
    connected: true,
    receivedAt: report.receivedAt,
    spentRecently: report.rows.some((row) => row.spend > 0),
    daysWithoutSpend,
    last7: { spend: summary.totals.spend, clicks: summary.totals.clicks, conversions: summary.totals.conversions },
    currency: summary.currency,
  };
}

// ---- the website's own visit record --------------------------------------------

async function gatherSite(today: string): Promise<WatchInput["site"]> {
  const yesterday = shiftDay(today, -1);
  const days = Array.from({ length: 8 }, (_, i) => shiftDay(yesterday, i - 7));
  const logs = await readVisitLogs([shiftDay(days[0], -1), ...days]);
  const stories = buildStories(logs.visits, logs.events, { from: `${days[0]}T00:00:00.000Z`, to: `${today}T00:00:00.000Z` });
  const perDay = days.map((day) => ({ day, meta: 0, google: 0 }));
  let adVisits = 0;
  let contacted = 0;
  const lastWeek = new Set(days.slice(-7));
  for (const story of stories) {
    const day = story.firstAt.slice(0, 10);
    const entry = perDay.find((d) => d.day === day);
    if (story.sourceKind === "meta_ad" && entry) entry.meta += 1;
    if (story.sourceKind === "google_ad" && entry) entry.google += 1;
    if ((story.sourceKind === "meta_ad" || story.sourceKind === "google_ad" || story.sourceKind === "other_ad") && lastWeek.has(day)) {
      adVisits += 1;
      if (story.contacted) contacted += 1;
    }
  }
  return { days: perDay, last7: { adVisits, contacted } };
}

// ---- the CRM ----------------------------------------------------------------------

async function gatherCrm(today: string, nowMs: number): Promise<WatchInput["crm"]> {
  const leads = await getBuyersClient().fetch<
    Array<{ _id: string; _createdAt: string; name: string; source?: string; stage?: string; tasks?: LeadTask[] }>
  >(`*[_type == "lead"]{ _id, _createdAt, name, source, stage, tasks }`);
  const waiting: WatchInput["crm"]["waiting"] = [];
  const weekAgo = new Date(nowMs - 7 * 86_400_000).toISOString();
  const newLast7 = { website: 0, facebook: 0, other: 0 };
  for (const lead of leads) {
    if (lead._createdAt > weekAgo) {
      if (lead.source === "website") newLast7.website += 1;
      else if (lead.source === "meta_ads") newLast7.facebook += 1;
      else newLast7.other += 1;
    }
    if (lead.stage === "lost") continue;
    const reply = (lead.tasks ?? []).find((t) => !t.done && /^reply to\b/i.test(t.text) && (t.due ?? today) < today);
    if (reply) {
      const from = (reply.createdAt ?? `${reply.due}T00:00:00Z`).slice(0, 10);
      const days = Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
      waiting.push({ id: lead._id, name: lead.name, days });
    }
  }
  waiting.sort((a, b) => b.days - a.days);
  return { waiting, newLast7 };
}

// ---- the ads autopilot -------------------------------------------------------------

async function gatherPilot(): Promise<PilotWatch> {
  const settings = pilotSettings();
  if (settings.mode === "off") return { mode: "off", ranAt: null, errors: [], monthCap: null, spentMtd: null, dailyTarget: null, changes: [] };
  const [run, toggle] = await Promise.all([readPilotRun(), readPilotSwitch()]);
  const describe = (c: NonNullable<typeof run>["changes"][number]) =>
    c.kind === "pause" ? `${c.name} paused` : c.kind === "enable" ? `${c.name} switched back on` : `${c.name} ${usd(c.fromBudget ?? 0)} to ${usd(c.toBudget ?? 0)} a day`;
  return {
    mode: settings.mode === "dry" ? "dry" : toggle.paused ? "paused" : "on",
    ranAt: run?.ranAt ?? null,
    errors: run?.errors ?? [],
    monthCap: run?.plan?.monthCap ?? null,
    spentMtd: run?.plan?.spentMtd ?? null,
    dailyTarget: run?.plan?.dailyTarget ?? null,
    changes: (run?.changes ?? []).filter((c) => c.done !== "not").map(describe),
  };
}

// ---- Claude's note (optional) ----------------------------------------------------

const NOTE_SYSTEM = `You write the two-to-four sentence note at the top of a daily email to the owner of a property development about how his adverts and enquiries are doing. You are given the day's findings. Say what matters most and what to do first, in plain words, kindly and briefly. Use only the numbers that appear in the findings, exactly as written; never work out new ones. No greeting, no sign-off, no lists.`;

async function claudeNote(findings: Finding[]): Promise<string | null> {
  if (!claudeConfigured()) return null;
  const text = findings.map((f) => `[${f.level}] ${f.area}: ${f.title}${f.detail ? ` (${f.detail})` : ""}`).join("\n");
  const result = await writeWithClaude<{ note: string }>({
    system: NOTE_SYSTEM,
    content: [{ type: "text", text: `FINDINGS\n${text}\n\nWrite the note.` }],
    schema: { type: "object", properties: { note: { type: "string" } }, required: ["note"], additionalProperties: false },
    effort: "low",
    maxTokens: 4000,
    purpose: "ads check note",
  });
  if (!result.ok) return null;
  const note = result.value.note.trim();
  // Every number in the note must be one the findings already hold.
  const numbers = note.match(/\d[\d,.]*/g) ?? [];
  return numbers.every((num) => text.includes(num.replace(/[.,]$/, ""))) ? note.slice(0, 900) : null;
}

// ---- the run -------------------------------------------------------------------------

export async function readWatchdog(): Promise<WatchdogRun | null> {
  try {
    return (await getBuyersClient().getDocument<WatchdogRun>(RUN_ID)) ?? null;
  } catch {
    return null;
  }
}

/** One check. `email: false` (the dashboard's "Check now") never emails. Never throws. */
export async function runWatchdog(opts: { email: boolean; nowMs?: number }): Promise<WatchdogRun | { error: string }> {
  try {
    const nowMs = opts.nowMs ?? Date.now();
    const today = todayISO();
    const [meta, google, site, crm, settings, leadsState, pilot] = await Promise.all([
      gatherMeta(today).catch((e: Error): WatchInput["meta"] => ({
        connected: true,
        error: e.message,
        currency: "USD",
        yesterday: { spend: 0, leads: 0 },
        last3: { spend: 0, leads: 0 },
        last7: { spend: 0, leads: 0, linkClicks: 0 },
        prev7: { spend: 0, leads: 0 },
        campaigns: [],
        problemAds: [],
      })),
      gatherGoogle(today),
      gatherSite(today),
      gatherCrm(today, nowMs),
      client.fetch<{ promoBanner?: { enabled?: boolean; message?: string } } | null>(`*[_type == "siteSettings"][0]{ promoBanner }`),
      readMetaLeadsState(),
      gatherPilot().catch((): PilotWatch | null => null),
    ]);

    const findings = checkAll({
      today,
      nowMs,
      meta,
      google,
      site,
      crm,
      offer: parseOffer(settings?.promoBanner?.message, settings?.promoBanner?.enabled, today),
      metaLeads: { configured: metaLeadsConfigured(), lastOkAt: leadsState?.lastOkAt ?? null, lastError: leadsState?.lastError ?? null },
      pilot,
    });

    const emailing = opts.email && shouldEmail(findings, today);
    const summary = emailing ? await claudeNote(findings) : null;

    if (emailing) {
      const section = (title: string, level: Finding["level"]) => {
        const items = findings.filter((f) => f.level === level);
        return items.length ? [title, ...items.map((f) => `• ${f.title}${f.detail ? ` ${f.detail}` : ""}`)] : [];
      };
      await sendNotice(emailSubject(findings, today), [
        ...(summary ? [summary] : []),
        ...section("Needs you:", "act"),
        ...section("Keep an eye on:", "watch"),
        ...section("The numbers:", "ok"),
        `Dashboard: ${SITE_URL}/admin/dashboard`,
      ]);
    }

    const previous = await readWatchdog();
    const ranAt = new Date(nowMs).toISOString();
    const run: WatchdogRun = {
      _id: RUN_ID,
      _type: "agentRun",
      ranAt,
      findings: findings.map((f) => ({ _key: newKey(), ...f, detail: f.detail ?? "" })),
      summary,
      emailed: emailing,
      history: [
        ...(previous?.history ?? []),
        { _key: newKey(), ranAt, act: findings.filter((f) => f.level === "act").length, watch: findings.filter((f) => f.level === "watch").length },
      ].slice(-30),
    };
    await getBuyersClient().createOrReplace(run);
    return run;
  } catch (error) {
    console.error("[ads watchdog] failed:", error);
    return { error: error instanceof Error ? error.message : "The check could not run." };
  }
}
