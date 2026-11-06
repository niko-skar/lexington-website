import type { GoogleAdText, GoogleClickType, GoogleLink, GoogleRow } from "@/lib/ads/google";

import { mentionsSoldOut } from "./adsManagerCore";
import { longDate } from "./factsCore";
import type { Finding } from "./watchdogCore";

/**
 * THE DAILY ADS HEALTH CHECK: the rules. Pure: adsPilot.ts gathers the figures and makes the fixes.
 *
 * Why it exists (Niko, 5-6 Nov 2026: "yes build a daily alert for yourself and the agents so it can be fixed
 * automatically"). The Google adverts carried the map pins of every business in the Google Business account, so
 * from 22 Aug most of their money went on Google Maps "directions" taps, $94 of it on Kaiser Kitchen's address, and
 * only 115 of 1,463 clicks ever reached the website. Nobody noticed for ten weeks because every check counted clicks.
 * Old prices also stayed in a callout ("From $72,000") and in the adverts' words after VAT came in and the studios
 * sold. So every morning:
 *
 * 1. Map pins: the Lexington's adverts have none (his words: "why would i want any map ads?"). Any location linked to
 *    them is taken off, by the Google Ads script.
 * 2. Where the clicks go: Google's clicks over the last 7 days against the visitors the website's own record saw
 *    arrive from a Google advert. Too few arriving, with nothing here to explain it, stops Google's spending until
 *    it is found (the money is otherwise paid for nothing) and asks Claude to look.
 * 3. The adverts' words: a price that is not one of today's prices for a home for sale, a "+ VAT" price, a kind of
 *    home that is sold out, or an offer whose end date has passed. A callout, sitelink or snippet saying so is taken
 *    off; an ad saying so is paused when its ad group has another ad that is right, otherwise Claude rewrites it.
 *
 * The same check of words (`staleCopy`) is used for the Instagram and Facebook posts and the lead forms, which no
 * key can change: those are for Claude and Niko.
 */

export interface HealthProblem {
  /** The same problem keeps the same key from day to day, so it is told once. */
  key: string;
  level: "act" | "watch";
  title: string;
  detail: string;
  /** Who puts it right: the agents (done, or queued for the Google script), Claude (the daily watcher) or Niko. */
  fix: "agent" | "claude" | "owner";
}

export interface GoogleFix {
  key: string;
  op: "remove" | "pauseAd";
  /** Google's name for the link or the ad. */
  resource: string;
  /** In words, for the record and the alert. */
  what: string;
}

export interface GoogleHealthInput {
  /** YYYY-MM-DD, the account's day (GMT). */
  today: string;
  rows: readonly GoogleRow[];
  /** Visitors the website saw arrive from a Google advert, by day. */
  arrivals: Readonly<Record<string, number>>;
  /** Null: the script is older than version 3 and doesn't say. */
  clickTypes: readonly GoogleClickType[] | null;
  links: readonly GoogleLink[] | null;
  ads: readonly GoogleAdText[] | null;
  /** Today's prices (`allowedAmounts`): every dollar amount the website shows for a home for sale, fees and extras. */
  prices: ReadonlySet<number>;
  /** Kinds of home none of which is for sale ("studio"). */
  soldOut: readonly string[];
  /** Campaigns switched on or paused (removed ones aside), by id: the Google holders. */
  liveCampaigns: ReadonlySet<string>;
}

export interface GoogleHealth {
  problems: HealthProblem[];
  fixes: GoogleFix[];
  /** Stop Google's spending: its clicks aren't reaching the website and nothing here explains why. */
  hold: { reason: string } | null;
  /** The last 7 days, for the record. */
  traffic: { clicks: number; arrivals: number; mapClicks: number | null; callClicks: number | null };
}

/** Over 7 days, at least this many clicks before arrivals are judged. */
export const LEAK_MIN_CLICKS = 10;
/** Fewer than this share of the website-bound clicks arriving is a leak (blockers and slow phones lose some). */
export const LEAK_MIN_SHARE = 0.4;
/** Map clicks above this share of all clicks (and at least MAP_MIN_CLICKS) are a problem even with no pins found. */
export const MAP_MAX_SHARE = 0.3;
export const MAP_MIN_CLICKS = 5;

const WEBSITE_CLICKS = new Set(["URL_CLICKS", "SITELINKS", "BREADCRUMBS", "LOCATION_FORMAT_LANDING_PAGE", "PRODUCT_LISTING_AD_CLICKS"]);
const CALL_CLICKS = new Set(["CALLS", "CALL_TRACKING", "MOBILE_CALL_TRACKING", "LOCATION_FORMAT_CALL"]);

/** A tap that opens Google Maps (directions, the location card, nearby places, a pin) instead of the website. */
export function isMapClick(type: string): boolean {
  if (WEBSITE_CLICKS.has(type) || CALL_CLICKS.has(type)) return false;
  return /DIRECTION|LOCATION|STORE|MAP|PIN/.test(type);
}

export function isCallClick(type: string): boolean {
  return CALL_CLICKS.has(type);
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * The dollar amounts in `text` that are not today's prices: anything but `prices`, the $10,000 reservation (VAT
 * included) and sums under $100. A price written with "+ VAT" after it is from before VAT was in every price.
 */
export function oldAmounts(text: string, prices: ReadonlySet<number>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:US)?\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?k\b)?(\s*\+\s*VAT)?/gi)) {
    const value = Math.round(Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));
    if (m[3]) {
      out.push(`$${value.toLocaleString("en-US")} + VAT`);
      continue;
    }
    // Small sums are not prices, except the rates per m2 (finishes $180 and $360), which are in prices.
    if (value === 10_000 || value < 100) continue;
    if (!prices.has(value)) out.push(`$${value.toLocaleString("en-US")}`);
  }
  return [...new Set(out)];
}

/** "ends on 31 October", "until 30th November": the dates in `text` that an offer ends, which are before `today`. */
export function pastDeadlines(text: string, today: string): string[] {
  const out: string[] = [];
  const re = /\b(?:ends?|ending|until|till|closes?|expires?)\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)|\b(?:ends?|ending|until|till|closes?|expires?)\s+(?:on\s+)?([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  for (const m of text.matchAll(re)) {
    const dayOf = Number(m[1] ?? m[4]);
    const month = MONTHS.indexOf(String(m[2] ?? m[3]).toLowerCase());
    if (month < 0 || dayOf < 1 || dayOf > 31) continue;
    // The year is the one that puts the date nearest today: "15 January" said in November is the coming one.
    const year = Number(today.slice(0, 4));
    const iso = (y: number) => `${y}-${String(month + 1).padStart(2, "0")}-${String(dayOf).padStart(2, "0")}`;
    const away = (d: string) => Math.abs(Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`));
    const date = [iso(year - 1), iso(year), iso(year + 1)].sort((a, b) => away(a) - away(b))[0];
    if (date < today) out.push(`${dayOf} ${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)}`);
  }
  return [...new Set(out)];
}

/** What is out of date in an advert's, post's or form's words, in plain words; empty when nothing is. */
export function staleCopy(text: string, facts: { prices: ReadonlySet<number>; soldOut: readonly string[]; today: string }): string[] {
  const out: string[] = [];
  const amounts = oldAmounts(text, facts.prices);
  if (amounts.length) out.push(`quotes ${amounts.join(", ")}, not a price on the website today`);
  const sold = mentionsSoldOut(text, facts.soldOut);
  if (sold) out.push(`offers ${sold}s, and none is left for sale`);
  const ended = pastDeadlines(text, facts.today);
  if (ended.length) out.push(`says an offer ends on ${ended.join(", ")}, which has passed`);
  return out;
}

const shorten = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function checkGoogleHealth(input: GoogleHealthInput): GoogleHealth {
  const problems: HealthProblem[] = [];
  const fixes: GoogleFix[] = [];
  const facts = { prices: input.prices, soldOut: input.soldOut, today: input.today };
  const mine = (campaignId: string) => !campaignId || input.liveCampaigns.has(campaignId);

  // 1. Map pins: none, ever.
  const pins = (input.links ?? []).filter((l) => l.kind === "location" && mine(l.campaignId));
  for (const pin of pins) {
    fixes.push({ key: `pin:${pin.resource}`, op: "remove", resource: pin.resource, what: `the map pins added to ${pin.level === "account" ? "every campaign" : `campaign ${pin.campaignId}`}` });
  }
  if (pins.length) {
    problems.push({
      key: "google-map-pins",
      level: "act",
      title: "Google adverts were showing map pins: taken off",
      detail: "Map pins put the adverts on Google Maps, where people tap for directions instead of visiting the website. The Google Ads script takes them off within the hour.",
      fix: "agent",
    });
  }

  // 2. Where the clicks go, the last 7 complete days.
  const days = Array.from({ length: 7 }, (_, i) => shift(input.today, i - 7));
  const inWeek = new Set(days);
  const live = (r: { campaignId: string }) => mine(r.campaignId);
  const clicks = input.rows.filter((r) => inWeek.has(r.day) && live(r)).reduce((s, r) => s + r.clicks, 0);
  const arrivals = days.reduce((s, d) => s + (input.arrivals[d] ?? 0), 0);
  const types = input.clickTypes?.filter(live) ?? null;
  const mapClicks = types ? types.filter((t) => isMapClick(t.type)).reduce((s, t) => s + t.clicks, 0) : null;
  const callClicks = types ? types.filter((t) => isCallClick(t.type)).reduce((s, t) => s + t.clicks, 0) : null;
  const traffic = { clicks, arrivals, mapClicks, callClicks };
  let hold: GoogleHealth["hold"] = null;

  if (mapClicks !== null && mapClicks >= MAP_MIN_CLICKS && clicks > 0 && mapClicks / clicks >= MAP_MAX_SHARE && !pins.length) {
    // Map taps with no pins to take off: something else puts the adverts on Maps.
    problems.push({
      key: "google-map-clicks",
      level: "act",
      title: `${mapClicks} of Google's ${clicks} clicks this week opened Google Maps, not the website`,
      detail: "No map pins were found to take off, so Google's spending is stopped until Claude finds what puts the adverts on Maps.",
      fix: "claude",
    });
    hold = { reason: `${mapClicks} of ${clicks} clicks in 7 days were Google Maps taps, with no map pins found to take off.` };
  }

  // The clicks that should land on the website: all of them, less map taps and calls (when the script says which).
  const towardsSite = clicks - (mapClicks ?? 0) - (callClicks ?? 0);
  if (!hold && towardsSite >= LEAK_MIN_CLICKS && arrivals < towardsSite * LEAK_MIN_SHARE) {
    problems.push({
      key: "google-leak",
      level: "act",
      title: `Only ${arrivals} of Google's ${towardsSite} website clicks this week reached the website`,
      detail:
        mapClicks === null
          ? "Google is being paid for clicks that never arrive, so its spending is stopped until Claude finds out why. (The Google Ads script is older than version 3, so it doesn't say where the clicks went.)"
          : "Google is being paid for clicks that never arrive, so its spending is stopped until Claude finds out why (a broken page, the wrong address, or clicks that aren't people).",
      fix: "claude",
    });
    hold = { reason: `${arrivals} of ${towardsSite} website clicks in 7 days reached the website.` };
  }

  // 3. The words: callouts, sitelinks and snippets first, then the ads.
  for (const link of (input.links ?? []).filter((l) => l.kind === "text" && mine(l.campaignId))) {
    const wrong = staleCopy(link.text, facts);
    if (!wrong.length) continue;
    fixes.push({ key: `words:${link.resource}`, op: "remove", resource: link.resource, what: `"${shorten(link.text)}" (it ${wrong.join("; ")})` });
    problems.push({
      key: `google-words:${link.resource}`,
      level: "act",
      title: `A line under the Google adverts was out of date: taken off`,
      detail: `"${shorten(link.text)}" ${wrong.join("; ")}.`,
      fix: "agent",
    });
  }

  const ads = (input.ads ?? []).filter((a) => mine(a.campaignId));
  const wrongAds = new Map(ads.map((a) => [a.resource, staleCopy(a.texts.join(" | "), facts)] as const).filter(([, w]) => w.length > 0));
  for (const ad of ads) {
    const wrong = wrongAds.get(ad.resource);
    if (!wrong) continue;
    const goodSibling = ads.some((b) => b.adGroupId === ad.adGroupId && b.resource !== ad.resource && !wrongAds.has(b.resource));
    const line = ad.texts.find((t) => staleCopy(t, facts).length) ?? ad.texts[0] ?? "";
    if (goodSibling) {
      fixes.push({ key: `ad:${ad.resource}`, op: "pauseAd", resource: ad.resource, what: `the ad with "${shorten(line, 60)}" (it ${wrong.join("; ")})` });
      problems.push({
        key: `google-ad:${ad.resource}`,
        level: "act",
        title: "A Google ad was out of date: paused",
        detail: `"${shorten(line, 60)}" ${wrong.join("; ")}. Another ad in the same group carries on.`,
        fix: "agent",
      });
    } else {
      problems.push({
        key: `google-ad:${ad.resource}`,
        level: "act",
        title: "A Google ad is out of date and needs new words",
        detail: `"${shorten(line, 60)}" ${wrong.join("; ")}. It is the only ad in its group, so Claude rewrites it.`,
        fix: "claude",
      });
    }
  }

  return { problems, fixes, hold, traffic };
}

/* --- Posts and lead forms (staleCopy.ts finds them; no key can change them) ---------------------------- */

export interface StaleItem {
  id: string;
  where: "Instagram" | "Facebook" | "Lead form";
  /** YYYY-MM-DD it went up. */
  date: string;
  link: string;
  name: string;
  issues: string[];
  /** For a lead form: how many live ads open it. */
  liveAds: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The watchdog's findings: a live form is to act on every day until fixed; a post is told once (`seen` keeps them). */
export function staleFindings(items: readonly StaleItem[], seen: ReadonlySet<string>): Finding[] {
  const out: Finding[] = [];
  for (const form of items.filter((i) => i.where === "Lead form")) {
    out.push({
      level: "act",
      area: "Meta",
      title: `The lead form ${plural(form.liveAds, "live Facebook ad opens", "live Facebook ads open")} is out of date`,
      detail: `"${form.name}": it ${form.issues.join("; ")}. Claude makes a corrected copy and moves the ads onto it.`,
    });
  }
  const posts = items.filter((i) => i.where !== "Lead form");
  const fresh = posts.filter((p) => !seen.has(p.id));
  if (fresh.length) {
    out.push({
      level: "act",
      area: "Meta",
      title: `${plural(fresh.length, "post shows", "posts show")} out-of-date prices or offers`,
      detail: `${fresh.map((p) => `${p.where}, ${longDate(p.date)}: it ${p.issues.join("; ")}${p.link ? ` (${p.link})` : ""}`).join(" · ")}. Archive Instagram posts in the Instagram app (⋯ > Archive); Facebook Page posts can only be deleted.`,
    });
  }
  const known = posts.length - fresh.length;
  if (known > 0) {
    out.push({
      level: "watch",
      area: "Meta",
      title: `${plural(known, "older post", "older posts")} with out-of-date prices still up`,
      detail: "Already told. Archive them in the Instagram app; Facebook Page posts can only be deleted.",
    });
  }
  return out;
}
