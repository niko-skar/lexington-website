/**
 * The ads manager's decisions and its copywriter's rules, without the plumbing (Niko, 22 Oct 2026:
 * "manage the entire ad, the content, the leads, the budget, the conversions, trying new things,
 * everything"). Pure, so every rule can be tested on its own; lib/agents/adsManager.ts reads the
 * account and makes the changes. The budgets are the autopilot's (adsPilotCore.ts).
 *
 * HIS DECISIONS (22 Oct 2026): new ads are written and published by themselves; the ads follow the
 * offer on the website banner (none when there is none); markets: Ghana and the US, UK and Canada
 * diaspora.
 *
 * THE RULES
 * - Every active ad set keeps two to four live ads. One new idea (a "challenger") per ad set a
 *   week, with an angle the ad set isn't running, best-performing untried angles first.
 * - An ad that spent twice its ad set's cost per real lead (at least $8) over 14 days without a
 *   real lead is switched off, while another ad in the set brings them; so is one rejected by Meta.
 *   The last live ad of a set is never switched off for results.
 * - An ad that quotes the banner offer is switched off once the offer has ended; ads with the offer
 *   are only made while it has more than two days to run.
 * - An ad set about to reach its end date keeps running (its end date is taken off) once it has an
 *   ad without the offer.
 * - An ad set whose new ads Meta keeps rejecting (three made in the last week, none running in good
 *   standing) is switched off and gets no more ads; Niko is told once. One he switches back on starts
 *   afresh. (The UK, 23 Oct to 3 Nov 2026: Meta read the ads as loans and wanted the business verified,
 *   and the manager made four new UK ads every day, 37 in all.)
 * - Markets not running yet (UK, Canada) are tried once each, as a new ad set, on the share of the
 *   budget the autopilot gives anything new.
 * - At most six new ads a run, two per ad set.
 */

import { inclVatSuffix } from "@/lib/vat";

import { VAT_ON_TOP } from "./factcheck";
import type { FactPack } from "./factsCore";

export type Market = "ghana" | "us" | "uk" | "canada";

export const MARKET_NAMES: Record<Market, string> = {
  ghana: "Ghana",
  us: "US",
  uk: "UK",
  canada: "Canada",
};

/** Cities for a new diaspora ad set, and how wide around each (housing ads: at least 25 km in the US and Canada, 15 km in Europe). */
export const MARKET_CITIES: Record<"uk" | "canada", Array<{ q: string; country: string; radiusKm: number }>> = {
  uk: [
    { q: "London", country: "GB", radiusKm: 30 },
    { q: "Birmingham", country: "GB", radiusKm: 25 },
    { q: "Manchester", country: "GB", radiusKm: 25 },
  ],
  canada: [
    { q: "Toronto", country: "CA", radiusKm: 40 },
    { q: "Montreal", country: "CA", radiusKm: 30 },
    { q: "Ottawa", country: "CA", radiusKm: 30 },
  ],
};

export type AngleKey = "price" | "plan" | "location" | "progress" | "amenities" | "homes" | "abroad";

/** What each kind of ad leads with. The copywriter gets the brief; the picture comes from the matching gallery. */
export const ANGLES: Record<AngleKey, { brief: string; pictures: Array<"exterior" | "interior" | "amenity" | "progress" | "floorplan">; markets?: Market[] }> = {
  price: {
    brief: "Lead with the lowest price of the homes on sale ('from $...') and that $10,000 reserves one.",
    pictures: ["exterior", "interior"],
  },
  plan: {
    brief: "Lead with how to pay: in full, or on a plan of up to 18 months, or with a mortgage, and that $10,000 reserves a home.",
    pictures: ["exterior", "interior"],
  },
  location: {
    brief: "Lead with where it is: 18 Duala Close, Shiashie, East Legon, Accra. Do not name landmarks, roads or distances the facts don't give.",
    pictures: ["exterior"],
  },
  progress: {
    brief: "Lead with the building going up now (the latest site update) and the estimated completion, said to be an estimate. Point to the progress page.",
    pictures: ["progress"],
  },
  amenities: {
    brief: "Lead with the shared amenities, named exactly as in the facts. Only the residents' rooftop garden is on the roof; the pool is not.",
    pictures: ["amenity"],
  },
  homes: {
    brief: "Lead with the range of homes, from studios to duplex penthouses, with sizes in m² (and sq ft for the US and Canada).",
    pictures: ["interior", "floorplan"],
  },
  abroad: {
    brief: "For someone living abroad: reserving and paying for a home in Accra from wherever they are, with the sales team arranging it. Never say or suggest who the reader is (nationality, origin, age, money).",
    pictures: ["exterior", "interior"],
    markets: ["us", "uk", "canada"],
  },
};

export interface AdTag {
  market: Market;
  angle: AngleKey;
  /** The offer's last day when the ad quotes it. */
  offerUntil: string | null;
  made: string;
}

const TAG_RE = /^LEX (ghana|us|uk|canada) · (price|plan|location|progress|amenities|homes|abroad) · (\d{4}-\d{2}-\d{2})(?: · offer to (\d{4}-\d{2}-\d{2}))?/;

/** The ad's name carries what it is: "LEX ghana · plan · 2026-10-23 · offer to 2026-10-31". */
export function adName(tag: AdTag): string {
  return `LEX ${tag.market} · ${tag.angle} · ${tag.made}${tag.offerUntil ? ` · offer to ${tag.offerUntil}` : ""}`;
}

export function readTag(name: string): AdTag | null {
  const m = TAG_RE.exec(name);
  return m ? { market: m[1] as Market, angle: m[2] as AngleKey, made: m[3], offerUntil: m[4] ?? null } : null;
}

/** Does the ad's own wording quote a discount or offer (for ads made by hand, which carry no tag)? */
export function quotesOffer(text: string): boolean {
  return /\b\d{1,2}\s?%|\bdiscount|\boffer\b|\bpromo|\bphase 1 pricing/i.test(text);
}

/**
 * A price as ads gave it before VAT was in every price (Niko, 28 Oct 2026: "I want the full amount of vat
 * added everywhere we show a price"): "+ VAT" after it, or a figure that is not one of today's prices,
 * which all have the VAT in them. The $10,000 reservation fee (VAT included) and small amounts aside.
 */
/** The first sold-out kind of home ("studio") the text offers, or null. */
export function mentionsSoldOut(text: string, words: readonly string[]): string | null {
  for (const word of words) if (new RegExp(`\\b${word}s?\\b`, "i").test(text)) return word;
  return null;
}

export function quotesOldPrice(text: string, prices: ReadonlySet<number>): boolean {
  if (VAT_ON_TOP.test(text)) return true;
  for (const m of text.matchAll(/(?:US)?\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?k\b)?/gi)) {
    const value = Math.round(Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));
    if (value === 10_000 || value < 500) continue;
    if (!prices.has(value)) return true;
  }
  return false;
}

export interface AdInfo {
  id: string;
  name: string;
  adsetId: string;
  /** "live" = switched on (running, or waiting for Meta's review). */
  status: "live" | "paused" | "rejected";
  /** The ad's words: text, headline and description. */
  text: string;
  tag: AdTag | null;
  last14: { spend: number; leads: number; frequency: number };
  /** Meta flagged it: rejected, or switched off with a problem (what a rejected ad shows once it is paused). */
  problem?: boolean;
}

export interface AdsetInfo {
  id: string;
  name: string;
  campaignId: string;
  market: Market | null;
  /** "active" = switched on with its campaign. */
  status: "active" | "paused" | "ended";
  /** End date (YYYY-MM-DD) when it has one. */
  endDay: string | null;
  /** Its ads open a WhatsApp chat (click-to-WhatsApp, 12 Nov 2026), not a lead form. */
  whatsapp?: boolean;
  /**
   * A form ad set in a WhatsApp campaign (13 Nov 2026): its ads open the buyers' form (type of home, budget, when, where),
   * which ends with a "Chat on WhatsApp" button, so sellers don't reach the chat.
   */
  waForm?: boolean;
}

export interface ManagerInput {
  today: string;
  adsets: AdsetInfo[];
  ads: AdInfo[];
  /** The banner's offer, when it is switched on and readable. */
  offer: { endsOn: string | null; ended: boolean } | null;
  /** When each ad set last got a new ad from the manager. */
  lastNew: Record<string, string>;
  /** How each angle has done, over the ads the manager made (spend and real leads). */
  angleResults: Partial<Record<AngleKey, { spend: number; leads: number }>>;
  /** Markets he allows. */
  markets: Market[];
  /** Markets already tried once (made by the manager), so they are not made again. */
  marketsTried: Market[];
  /** While VAT is on: today's prices (all with the VAT in them). An ad quoting another figure, or "+ VAT", is replaced. */
  prices?: number[];
  /** Kinds of home that are sold out ("studio"): an ad offering one is replaced. */
  soldOut?: string[];
  /** Ad sets the manager switched off because Meta kept rejecting their ads, with the day. One switched back on starts afresh. */
  stoppedOn?: Record<string, string>;
}

export interface NewAd {
  adsetId: string;
  market: Market;
  angle: AngleKey;
  withOffer: boolean;
  /** minimum: the set is short of live ads; evergreen: it needs one without the offer; challenger: this week's new idea. */
  kind: "minimum" | "evergreen" | "challenger";
  reason: string;
  /** A WhatsApp ad: its button opens a WhatsApp chat. */
  whatsapp?: boolean;
  /** An ad for the buyers' form that ends with a WhatsApp button (13 Nov 2026). */
  waForm?: boolean;
}

export interface ManagerPlan {
  pause: Array<{ adId: string; adsetId: string; name: string; cause: "offer" | "results" | "rejected" | "vat" | "sold"; reason: string }>;
  create: NewAd[];
  /** Ad sets whose end date is taken off, so they keep running. */
  ongoing: Array<{ adsetId: string; name: string; reason: string }>;
  /** New markets to try, each a new ad set. */
  markets: Array<{ market: "uk" | "canada"; reason: string }>;
  /** Ad sets Meta keeps refusing: switched off, and no more ads are made for them. */
  stop: Array<{ adsetId: string; name: string; refused: number; reason: string }>;
  notes: string[];
}

const MAX_NEW_PER_RUN = 6;
const MAX_NEW_PER_SET = 2;
const MIN_LIVE = 2;
const MAX_LIVE = 4;
const CHALLENGER_DAYS = 7;
/** Meta refused this many of an ad set's new ads within REFUSED_DAYS, with none running in good standing: stop. */
const REFUSED_LIMIT = 3;
const REFUSED_DAYS = 7;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function shiftDay(day: string, days: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const yieldOf = (r: { spend: number; leads: number } | undefined) => (r ? (r.leads + 0.5) / (r.spend + 5) : 0.1);

/** The next angle for an ad set: one it isn't running, never tried in it first, then the best performer. */
export function nextAngle(input: ManagerInput, set: AdsetInfo, taken: AngleKey[]): AngleKey | null {
  const market = set.market ?? "ghana";
  const running = new Set([
    ...taken,
    ...input.ads.filter((a) => a.adsetId === set.id && a.status === "live" && a.tag).map((a) => a.tag!.angle),
  ]);
  const triedHere = new Set(input.ads.filter((a) => a.adsetId === set.id && a.tag).map((a) => a.tag!.angle));
  const options = (Object.keys(ANGLES) as AngleKey[]).filter((k) => !running.has(k) && (!ANGLES[k].markets || ANGLES[k].markets!.includes(market)));
  if (!options.length) return null;
  const fresh = options.filter((k) => !triedHere.has(k));
  const pool = fresh.length ? fresh : options;
  // With no results yet, the likeliest first: the price at home, reserving from abroad elsewhere.
  const order: AngleKey[] =
    market === "ghana"
      ? ["price", "plan", "homes", "location", "progress", "amenities", "abroad"]
      : ["abroad", "price", "plan", "homes", "progress", "location", "amenities"];
  return [...pool].sort((a, b) => yieldOf(input.angleResults[b]) - yieldOf(input.angleResults[a]) || order.indexOf(a) - order.indexOf(b))[0];
}

export function planManager(input: ManagerInput): ManagerPlan {
  const plan: ManagerPlan = { pause: [], create: [], ongoing: [], markets: [], stop: [], notes: [] };
  const offerLive = Boolean(input.offer && !input.offer.ended && input.offer.endsOn && daysBetween(input.today, input.offer.endsOn) > 2);
  const offerOver = (ad: AdInfo) => {
    if (ad.tag?.offerUntil) return ad.tag.offerUntil < input.today;
    // Made by hand: it quotes an offer, and the banner has none running.
    return quotesOffer(ad.text) && (!input.offer || input.offer.ended);
  };
  const sets = input.adsets.filter((s) => s.status === "active");
  const prices = input.prices?.length ? new Set(input.prices) : null;

  for (const set of sets) {
    const ads = input.ads.filter((a) => a.adsetId === set.id);
    const live = ads.filter((a) => a.status === "live");

    // Rejected by Meta: switched off, and a new one takes its place below.
    for (const a of ads.filter((x) => x.status === "rejected")) {
      plan.pause.push({ adId: a.id, adsetId: set.id, name: a.name, cause: "rejected", reason: "Meta rejected it." });
    }
    // Meta keeps refusing this set's new ads (the UK, 23 Oct to 3 Nov 2026: 37 in 11 days, four more every
    // morning): stop making them, switch the set off, and say so once. Only ads the manager made count, and
    // only those made since the set was last stopped, so one he switches back on starts afresh.
    const since = [shiftDay(input.today, -REFUSED_DAYS), input.stoppedOn?.[set.id] ?? ""].sort().pop() as string;
    const refused = ads.filter((a) => a.problem && a.tag && a.tag.made > since);
    if (refused.length >= REFUSED_LIMIT && !live.some((a) => !a.problem)) {
      plan.stop.push({
        adsetId: set.id,
        name: set.name,
        refused: refused.length,
        reason: `Meta refused ${refused.length} of its new ads in the last ${REFUSED_DAYS} days and none is running, so no more are made and the ad set is switched off.`,
      });
      continue;
    }
    // The offer it quotes has ended.
    const expired = live.filter(offerOver);
    for (const a of expired) {
      plan.pause.push({ adId: a.id, adsetId: set.id, name: a.name, cause: "offer", reason: "It quotes an offer that has ended." });
    }
    // A price from before VAT was in every price ("+ VAT", or a figure the website no longer shows):
    // switched off, and a new ad takes its place below.
    const noVat = prices ? live.filter((a) => !expired.includes(a) && quotesOldPrice(a.text, prices)) : [];
    for (const a of noVat) {
      plan.pause.push({ adId: a.id, adsetId: set.id, name: a.name, cause: "vat", reason: "It quotes a price the website doesn't show for a home for sale." });
    }
    // It offers a kind of home that is sold out (Niko, 5 Nov 2026: "the two studios are sold so we can't advertise more
    // until we make new ones"): switched off too, and a new ad takes its place.
    const soldOut = live.filter((a) => !expired.includes(a) && !noVat.includes(a) && mentionsSoldOut(a.text, input.soldOut ?? []));
    for (const a of soldOut) {
      plan.pause.push({ adId: a.id, adsetId: set.id, name: a.name, cause: "sold", reason: `It offers ${mentionsSoldOut(a.text, input.soldOut ?? [])}s, and none is left for sale.` });
    }
    let keep = live.filter((a) => !expired.includes(a) && !noVat.includes(a) && !soldOut.includes(a));

    // Spending without real leads, while another ad in the set brings them.
    const spend = keep.reduce((s, a) => s + a.last14.spend, 0);
    const leads = keep.reduce((s, a) => s + a.last14.leads, 0);
    if (leads >= 1 && keep.length >= 2) {
      const cpl = spend / leads;
      const limit = Math.max(8, 2 * cpl);
      const losers = keep.filter((a) => a.last14.leads < 0.5 && a.last14.spend >= limit);
      const winners = keep.filter((a) => a.last14.leads >= 1);
      for (const a of losers) {
        if (!winners.length || keep.length - 1 < 1) break;
        plan.pause.push({
          adId: a.id,
          adsetId: set.id,
          name: a.name,
          cause: "results",
          reason: `Spent $${a.last14.spend.toFixed(2)} in 14 days without a real lead (they cost $${cpl.toFixed(2)} on the other ads in its set).`,
        });
        keep = keep.filter((x) => x.id !== a.id);
      }
    }

    // New ads: up to two live, plus a weekly challenger while there's room.
    const evergreen = keep.filter((a) => !(a.tag?.offerUntil || quotesOffer(a.text)));
    let wanted = Math.max(0, MIN_LIVE - keep.length);
    if (!evergreen.length && wanted === 0) wanted = 1; // always one without the offer, so the set can outlive it
    const last = input.lastNew[set.id];
    if (wanted === 0 && keep.length < MAX_LIVE && (!last || daysBetween(last, input.today) >= CHALLENGER_DAYS)) wanted = 1;
    wanted = Math.min(wanted, MAX_NEW_PER_SET);
    const taken: AngleKey[] = [];
    for (let i = 0; i < wanted && plan.create.length < MAX_NEW_PER_RUN; i += 1) {
      const angle = nextAngle(input, set, taken);
      if (!angle) break;
      taken.push(angle);
      // While the offer runs, the challenger may carry it; the set always keeps one without.
      const withOffer = offerLive && (evergreen.length > 0 || i > 0) && angle !== "progress" && angle !== "location";
      const kind: NewAd["kind"] = keep.length + i < MIN_LIVE ? "minimum" : !evergreen.length && i === 0 ? "evergreen" : "challenger";
      plan.create.push({
        adsetId: set.id,
        whatsapp: Boolean(set.whatsapp),
        ...(set.waForm && { waForm: true }),
        market: set.market ?? "ghana",
        angle,
        withOffer,
        kind,
        reason:
          keep.length < MIN_LIVE
            ? `${set.name} has ${keep.length} live ad${keep.length === 1 ? "" : "s"}; it keeps two.`
            : !evergreen.length
              ? `${set.name} needs an ad without the offer, to keep running after it ends.`
              : `This week's new idea for ${set.name}: the ${angle} angle.`,
      });
    }

    // About to reach its end date: keep it running, now that it has (or is getting) an ad without the offer.
    if (set.endDay && daysBetween(input.today, set.endDay) <= 3) {
      const hasEvergreen = evergreen.length > 0 || plan.create.some((c) => c.adsetId === set.id && !c.withOffer);
      if (hasEvergreen) plan.ongoing.push({ adsetId: set.id, name: set.name, reason: `It was set to stop on ${set.endDay}; it now runs on, with ads that don't depend on the offer.` });
      else plan.notes.push(`${set.name} stops on ${set.endDay}: no ad without the offer could be made for it yet.`);
    }
  }

  // Markets not tried yet: one at a time, when nothing else is being made.
  if (plan.create.length <= 2) {
    const present = new Set(input.adsets.filter((s) => s.status !== "ended").map((s) => s.market));
    for (const m of ["uk", "canada"] as const) {
      if (!input.markets.includes(m) || present.has(m) || input.marketsTried.includes(m)) continue;
      plan.markets.push({ market: m, reason: `Trying the ${MARKET_NAMES[m]} diaspora: a new ad set on a small share of the budget.` });
      break;
    }
  }
  return plan;
}

// ---- the copywriter ---------------------------------------------------------------------------

export interface AdCopy {
  primary_text: string;
  headline: string;
  description: string;
}

export const AD_COPY_SCHEMA = {
  type: "object",
  properties: {
    primary_text: { type: "string" },
    headline: { type: "string" },
    description: { type: "string" },
  },
  required: ["primary_text", "headline", "description"],
  additionalProperties: false,
} as const;

export const AD_COPY_SYSTEM = `You write Facebook and Instagram lead ads for The Lexington, a building of apartments for sale in East Legon, Accra, Ghana. People who tap the ad fill in a short form and the sales team contacts them.

Rules you never break:
- Use only facts from the FACTS. Every price, size, percentage, date, amenity and place must be there, word for word or as a plain rounding the facts allow. Never invent a landmark, a distance, a return on investment, a rental income, a guarantee, a scarcity claim ("only 3 left") or a deadline the facts don't state.
- Mention an offer or discount only when told the ad may carry it, and then exactly as the banner says, with its last day.
- Never say or suggest who the reader is: no nationality, origin, ethnicity, religion, age, family status, health or money ("you're Ghanaian", "for Africans abroad", "if you can afford"). Speak about the homes, not the person. This is a housing ad and must welcome everyone.
- Plain, warm, confident English. No emojis, no hashtags, no exclamation marks in a row, no words in capitals.
- Primary text: two to four short sentences, at most 300 characters, ending with what to do (tap to get the prices / the floor plans / a call back).
- Headline: at most 40 characters. Description: at most 30 characters.
- Don't repeat the wording of the ads already running (given below); say something new.`;

export function adCopyPrompt(args: {
  facts: string;
  market: Market;
  angle: AngleKey;
  withOffer: boolean;
  running: string[];
  learnings: string[];
  whatsapp?: boolean;
  waForm?: boolean;
}): string {
  const feet = args.market === "us" || args.market === "canada";
  return [
    `FACTS\n${args.facts}`,
    `MARKET: ${MARKET_NAMES[args.market]}${args.market === "ghana" ? " (people in Ghana)" : " (people living there)"}. ${feet ? "Give sizes in square feet as well as m² when you give one." : ""}`,
    `ANGLE: ${ANGLES[args.angle].brief}`,
    args.withOffer ? "The ad MAY carry the banner offer, quoted exactly, with its last day." : "The ad must NOT mention any offer, discount or deadline.",
    args.waForm
      ? `BUTTON: this ad's button opens a short form for people buying a home (${WA_FORM_STEPS}), which ends with a WhatsApp chat with the sales team. Make clear the ad is for people looking to buy a home, and end the text by inviting them to tap, answer four quick questions and chat with the sales team on WhatsApp.`
      : args.whatsapp
        ? "BUTTON: this ad's button opens a WhatsApp chat with the sales team, not a form. Make clear the ad is for people looking to buy a home, and end the text by inviting them to message on WhatsApp (for the prices, the floor plans or a site visit)."
        : "",
    args.running.length ? `ADS ALREADY RUNNING IN THIS AD SET (say something different):\n${args.running.map((t) => `- ${t}`).join("\n")}` : "",
    args.learnings.length ? `WHAT HAS WORKED SO FAR:\n${args.learnings.map((t) => `- ${t}`).join("\n")}` : "",
    "Write the ad.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * The ad without Claude: plain sentences built from the facts alone, one per angle. Used when
 * Claude isn't set up or its ad doesn't pass the checks twice.
 */
export function templateAdCopy(pack: FactPack, market: Market, angle: AngleKey, withOffer: boolean, whatsapp = false, waForm = false): AdCopy {
  const copy = templateWords(pack, market, angle, withOffer);
  // The buyers' form that ends on WhatsApp: says who it is for and what happens next.
  if (waForm) return { ...copy, primary_text: copy.primary_text.replace(/ Tap [^.]*\.$/, ` ${WA_FORM_INVITE}`) };
  if (!whatsapp) return copy;
  // A WhatsApp ad ends with an invitation to message, not "tap for ...".
  return { ...copy, primary_text: copy.primary_text.replace(/ Tap [^.]*\.$/, " Message us on WhatsApp for the prices, the floor plans or a site visit.") };
}

/** The buyers' form in front of WhatsApp (form "Lexington - home buyers, then WhatsApp chat", 13 Nov 2026). */
export const WA_FORM_STEPS = "the type of home, the budget, when they want to buy and where they live";
export const WA_FORM_INVITE = "Buying a home? Tap, answer four quick questions and chat with our sales team on WhatsApp.";
/** Which of the Page's lead forms is the buyers' form that ends on WhatsApp, and which is the usual one. */
export const isWaFormName = (name: string) => /whatsapp/i.test(name);

function templateWords(pack: FactPack, market: Market, angle: AngleKey, withOffer: boolean): AdCopy {
  const forSale = pack.units.filter((u) => u.status === "available");
  // The studios sold out on 4 Nov 2026: the words follow what is still for sale.
  const studios = forSale.some((u) => /studio/i.test(u.type));
  const lowest = forSale.length ? Math.min(...forSale.map((u) => u.priceUSD)) : null;
  const incl = inclVatSuffix(pack.vat);
  const from = lowest ? `Homes from ${dollars(lowest)}${incl}` : "Homes for sale";
  const reserve = `Reserve one with ${dollars(pack.reservationFeeUSD)}${pack.vat.on ? ", VAT included" : ""}.`;
  const where = "East Legon, Accra";
  const offer = withOffer && pack.offer && !pack.offer.ended ? ` ${pack.offer.text}` : "";
  const texts: Record<AngleKey, AdCopy> = {
    price: {
      primary_text: `${from} at The Lexington, ${where}. ${reserve}${offer} Tap to see the prices and floor plans.`,
      headline: lowest ? `From ${dollars(lowest)}${incl} in East Legon` : "Homes in East Legon",
      description: studios ? "Studios to penthouses" : "One-bedrooms to penthouses",
    },
    plan: {
      primary_text: `Pay in full, or over up to 18 months, for a home at The Lexington, ${where}. ${reserve}${offer} Tap for a call back.`,
      headline: "Pay over up to 18 months",
      description: "The Lexington, Accra",
    },
    location: {
      primary_text: `The Lexington: homes at 18 Duala Close, Shiashie, ${where}. ${from}. Tap to see the homes and the floor plans.`,
      headline: "Homes in East Legon, Accra",
      description: "18 Duala Close, Shiashie",
    },
    progress: {
      primary_text: `The Lexington is going up in ${where}: see the latest from site. Estimated completion ${pack.completion} (an estimate). Tap for the prices.`,
      headline: "See the building going up",
      description: "The Lexington, Accra",
    },
    amenities: {
      primary_text: `A residents' rooftop garden, and a shared swimming pool, gym, sauna and café at The Lexington, ${where}. ${from}. Tap for the details.`,
      headline: "Pool, gym and rooftop garden",
      description: "The Lexington, Accra",
    },
    homes: {
      primary_text: `${studios ? "Studios, one-" : "One-"}, two- and three-bedroom apartments and duplex penthouses at The Lexington, ${where}. ${from}. Tap for the floor plans.`,
      headline: studios ? "Studios to duplex penthouses" : "One-bedrooms to penthouses",
      description: "The Lexington, Accra",
    },
    abroad: {
      primary_text: `Reserve a home at The Lexington, ${where}, from wherever you are: the sales team arranges it with you. ${reserve} Tap for a call back.`,
      headline: "A home in Accra, reserved remotely",
      description: market === "ghana" ? "The Lexington" : "The Lexington, Accra",
    },
  };
  return texts[angle];
}

const PERSONAL = /\b(you'?re|you are|as an?|for)\s+(an?\s+|the\s+|all\s+)?(ghanaians?|africans?|nigerians?|black|white|christians?|muslims?|diaspora\w*|immigrants?|expats?|retirees?|seniors?|young|single|married|parents?|wealthy|rich|millionaires?)\b/i;
const BANNED_AD = /\b(guarantee\w*|risk[- ]free|roi\b|returns?\b|yield|rental income|passive income|only \d+ (left|remaining)|selling fast|last chance|diaspora|yenfie|skarlatos|olympian)\b/i;

/** What is wrong with an ad's words, beyond the fact check: lengths, personal attributes, banned claims, shouting. */
export function adCopyProblems(copy: AdCopy, opts: { withOffer: boolean; soldOut?: readonly string[] }): string[] {
  const out: string[] = [];
  const all = `${copy.primary_text}\n${copy.headline}\n${copy.description}`;
  if (!copy.primary_text.trim() || !copy.headline.trim()) out.push("The text or headline is empty.");
  if (copy.primary_text.length > 320) out.push(`The text is ${copy.primary_text.length} characters (at most 300).`);
  if (copy.headline.length > 40) out.push(`The headline is ${copy.headline.length} characters (at most 40).`);
  if (copy.description.length > 30) out.push(`The description is ${copy.description.length} characters (at most 30).`);
  if (PERSONAL.test(all)) out.push("It says who the reader is (not allowed in housing ads).");
  const banned = BANNED_AD.exec(all);
  if (banned) out.push(`It says "${banned[0]}", which the ads never say.`);
  if (/\b[A-Z]{4,}\b/.test(all.replace(/\b(LED|CCTV|USD|GHS)\b/g, ""))) out.push("It has a word in capitals.");
  if (/!!|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all)) out.push("It has emojis or repeated exclamation marks.");
  if (!opts.withOffer && quotesOffer(all)) out.push("It mentions an offer or discount, which this ad may not.");
  const sold = mentionsSoldOut(all, opts.soldOut ?? []);
  if (sold) out.push(`It offers ${sold}s, and none is left for sale.`);
  return out;
}
