/**
 * The lead responder's thinking, without the plumbing: what the person seems to
 * want, which available units to suggest, what Claude is told, and the plain
 * reply used when Claude is not connected. Pure, so it can be tested on its own;
 * lib/agents/leadReply.ts does the loading, saving and sending.
 */
import { formatUSD } from "@/lib/format";
import { feeVatSuffix, vatSuffix, type Vat } from "@/lib/vat";

import { factPackText, longDate, type FactPack, type UnitFact } from "./factsCore";

export type LeadChannel = "website" | "facebook" | "manual";

/** Everything known about the person, as the reply is written. */
export interface LeadContext {
  name: string;
  email?: string;
  phone?: string;
  channel: LeadChannel;
  /** The website form's "Interested in" (it defaults to "One Bedroom Apartment", so it is only a hint). */
  interest?: string;
  unitNumber?: string;
  /** What they wrote, when it is known on its own. */
  message?: string;
  /** Their answers on a Facebook / Instagram lead form. */
  answers?: Array<{ question: string; answer: string }>;
  /** The prospect's timeline so far, oldest first (enquiries, notes). */
  history?: string[];
}

export interface Wanted {
  unit?: UnitFact;
  type?: string;
  budgetMin?: number;
  budgetMax?: number;
}

const TYPES: Array<[RegExp, string]> = [
  [/pent\s?house|duplex/i, "3BR Duplex Penthouse"],
  [/\bstudio\b/i, "Studio"],
  [/\b(?:three|3)\s*-?\s*(?:bed|br\b|bdr)/i, "Three Bedroom"],
  [/\b(?:two|2)\s*-?\s*(?:bed|br\b|bdr)/i, "Two Bedroom"],
  [/\b(?:one|1)\s*-?\s*(?:bed|br\b|bdr)/i, "One Bedroom"],
];

function typeIn(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return TYPES.find(([pattern]) => pattern.test(text))?.[1];
}

const norm = (unitNumber: string) => unitNumber.toLowerCase().replace(/\s+/g, "");

function unitIn(text: string | undefined, pack: FactPack): UnitFact | undefined {
  if (!text) return undefined;
  for (const m of text.matchAll(/\b(\d{3}[ab]|ph\s?\d[ab]|studio\s1)\b/gi)) {
    const unit = pack.units.find((u) => norm(u.unitNumber) === norm(m[1]));
    if (unit) return unit;
  }
  return undefined;
}

const money = (raw: string, k?: string) => Number(raw.replace(/,/g, "")) * (k && /k/i.test(k) ? 1000 : 1);

/** A budget in their words: "$70,000 - $150,000", "Under $70,000", "about 100k". */
export function budgetIn(text: string | undefined): { min?: number; max?: number } {
  if (!text) return {};
  const range = /\$?\s?(\d[\d,]*)\s?(k)?\s*(?:-|–|to)\s*\$?\s?(\d[\d,]*)\s?(k)?/i.exec(text);
  if (range) {
    const a = money(range[1], range[2]);
    const b = money(range[3], range[4]);
    if (a >= 10_000 && b > a) return { min: a, max: b };
  }
  const under = /(?:under|below|less than|up to|max(?:imum)?)\s*\$?\s?(\d[\d,]*)\s?(k)?/i.exec(text);
  if (under) {
    const v = money(under[1], under[2]);
    if (v >= 10_000) return { max: v };
  }
  const over = /(?:over|above|more than|from)\s*\$?\s?(\d[\d,]*)\s?(k)?/i.exec(text);
  if (over) {
    const v = money(over[1], over[2]);
    if (v >= 10_000) return { min: v };
  }
  const about = /(?:budget|around|about|approx\.?|roughly)[^$\d]{0,20}\$?\s?(\d[\d,]*)\s?(k)?/i.exec(text);
  if (about) {
    const v = money(about[1], about[2]);
    if (v >= 10_000) return { max: Math.round(v * 1.1) };
  }
  return {};
}

/** What the person seems to want: a named unit first, then a type, from their own words before the form's default. */
export function detectWanted(ctx: LeadContext, pack: FactPack): Wanted {
  const answers = (ctx.answers ?? []).map((a) => `${a.question}: ${a.answer}`).join("\n");
  const history = (ctx.history ?? []).join("\n");
  const unit =
    (ctx.unitNumber ? pack.units.find((u) => norm(u.unitNumber) === norm(ctx.unitNumber!)) : undefined) ??
    unitIn(ctx.message, pack) ??
    unitIn(answers, pack) ??
    unitIn(history, pack);
  const type = unit?.type ?? typeIn(ctx.message) ?? typeIn(answers) ?? typeIn(ctx.interest) ?? typeIn(history);
  const budget = [ctx.message, answers, history].map(budgetIn).find((b) => b.min || b.max) ?? {};
  return { unit, type, budgetMin: budget.min, budgetMax: budget.max };
}

/** The price the person would pay at best (the full-payment offer price while an offer runs). */
const bestPrice = (u: UnitFact) => u.fullPaymentPriceUSD ?? u.priceUSD;

/** Up to three available units to suggest, cheapest first. */
export function pickUnits(pack: FactPack, wanted: Wanted, max = 3): UnitFact[] {
  const available = pack.units.filter((u) => u.status === "available").sort((a, b) => a.priceUSD - b.priceUSD);
  const fits = (u: UnitFact) =>
    (wanted.budgetMax == null || bestPrice(u) <= wanted.budgetMax) && (wanted.budgetMin == null || u.priceUSD >= wanted.budgetMin * 0.8);

  if (wanted.unit && wanted.unit.status === "available") {
    const others = available
      .filter((u) => u.unitNumber !== wanted.unit!.unitNumber && u.type === wanted.unit!.type)
      .sort((a, b) => Math.abs(a.priceUSD - wanted.unit!.priceUSD) - Math.abs(b.priceUSD - wanted.unit!.priceUSD));
    return [wanted.unit, ...others].slice(0, max);
  }

  const type = wanted.type ?? wanted.unit?.type;
  if (type) {
    const sameType = available.filter((u) => u.type === type);
    const inBudget = sameType.filter(fits);
    if (inBudget.length) return inBudget.slice(0, max);
    if (sameType.length && wanted.budgetMax == null) return sameType.slice(0, max);
    // Nothing of that type (in their budget): the closest homes they can afford.
    const affordable = available.filter(fits);
    if (affordable.length) return affordable.slice(-max).reverse();
    return sameType.slice(0, max);
  }

  // No type at all: the first home of each size, in their budget where one is known.
  const picks: UnitFact[] = [];
  for (const t of ["Studio", "One Bedroom", "Two Bedroom", "Three Bedroom"]) {
    const first = available.find((u) => u.type === t && fits(u));
    if (first) picks.push(first);
  }
  return picks.slice(0, max);
}

// ---- the plain reply (used when Claude is not connected or fails) ---------

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** A +1 number: the person is in the USA or Canada, so sizes also go in square feet. */
export const usesFeet = (ctx: LeadContext) => /^\s*(?:\+|00)\s*1\b/.test(ctx.phone ?? "");

function plural(typeLine: string) {
  return typeLine.replace(/apartment$/, "apartments").replace(/penthouse$/, "penthouses");
}

export function unitLine(u: UnitFact, feet: boolean, vat: Vat): string {
  const size = `${u.areaSqm} m²${feet ? ` (${u.areaSqft} sq ft)` : ""}`;
  const plus = vatSuffix(vat);
  const offer =
    u.fullPaymentPriceUSD != null || u.planPriceUSD != null
      ? ` (offer: ${[
          u.fullPaymentPriceUSD != null ? `${formatUSD(u.fullPaymentPriceUSD)}${plus} paying in full` : "",
          u.planPriceUSD != null ? `${formatUSD(u.planPriceUSD)}${plus} on a payment plan` : "",
        ]
          .filter(Boolean)
          .join(", ")})`
      : "";
  return `- ${u.unitNumber}: ${u.typeLine.toLowerCase()}, ${u.floorName}, ${size}, ${formatUSD(u.priceUSD)}${plus}${offer}${u.has3D ? ", with a 3D plan" : ""}\n  ${u.link}`;
}

export interface ReplyText {
  subject: string;
  body: string;
  whatsapp: string;
}

export function templateReply(ctx: LeadContext, pack: FactPack, picks: UnitFact[]): ReplyText {
  const first = firstName(ctx.name);
  const feet = usesFeet(ctx);
  const sameType = picks.length > 0 && picks.every((u) => u.type === picks[0].type);
  const what = sameType ? plural(picks[0].typeLine).toLowerCase() : "homes";
  const offer = pack.offer;

  const lines: string[] = [`Hi ${first},`, "", "Thank you for your enquiry about The Lexington in Shiashie, East Legon.", ""];
  if (picks.length) {
    lines.push(`These ${what} are available now:`, ...picks.map((u) => unitLine(u, feet, pack.vat)), "");
  }
  lines.push(`You can see every available home, with floor plans and prices, here: ${pack.links.residences}`, "");
  if (offer) lines.push(`${offer.text}`, "");
  lines.push(
    `A ${formatUSD(pack.reservationFeeUSD)} reservation${feeVatSuffix(pack.vat)} holds a home: ${picks[0]?.reserveLink ?? pack.links.reserve}`,
    "",
    "So we can suggest the right home, could you tell us:",
    "- your budget,",
    "- whether you would pay in full or on a payment plan,",
    "- and when you would like to buy?",
    "",
    "We would be glad to show you the site or walk you through it on a video call.",
    "",
    "Kind regards,",
    "The Lexington sales team",
    pack.contact.phone
  );

  const cheapest = picks[0];
  const whatsapp = [
    `Hi ${first}, thank you for your enquiry about The Lexington in East Legon.`,
    cheapest
      ? `${sameType ? `Available ${what} start at` : "Homes start at"} ${formatUSD(cheapest.priceUSD)}${vatSuffix(pack.vat)} (${cheapest.unitNumber}, ${cheapest.areaSqm} m²).`
      : "",
    offer?.fullPaymentPct != null && offer.planPct != null
      ? `${offer.endsOn ? `Until ${longDate(offer.endsOn).replace(/ \d{4}$/, "")}: ` : ""}${offer.fullPaymentPct}% off paying in full, or ${offer.planPct}% off on a payment plan.`
      : "",
    `All homes and prices: ${pack.links.residences}`,
    "What budget do you have in mind, and would you pay in full or on a plan?",
    "- The Lexington sales team",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    subject: picks.length && sameType ? `${picks[0].typeLine.replace(/^./, (c) => c.toUpperCase())}s at The Lexington` : "Your enquiry about The Lexington",
    body: lines.join("\n"),
    whatsapp,
  };
}

// ---- what Claude is told -----------------------------------------------------

export const LEAD_REPLY_SYSTEM = `You write the first reply to someone who has asked about buying a home at The Lexington, a residential building under construction in Shiashie, East Legon, Accra, Ghana. The owner reads your draft and sends it under the sales team's name.

Write like a helpful person on the sales team: warm, plain, specific and short. No hype words (luxury, exclusive, stunning, dream, world-class), no emojis, at most one exclamation mark.

THE FACTS ARE ONLY WHAT YOU ARE GIVEN
- Use only the facts in the FACTS block: unit numbers, types, floors, sizes, prices, the offer, fees, finishes, extras, amenities, dates and links. Copy every number exactly as given. Do not round, add up, convert or work out any new number: no monthly instalments, totals, savings, yields or returns.
- When they ask something the facts don't answer (for example payment schedules, title or legal questions, rental income, a discount beyond the offer, handover details beyond the completion estimate), don't guess: say the team will come back to them on it, and list it in needs_owner.
- Never write bank or account details. Never name the developer company. The only rooftop amenity is the Private Resident's Rooftop Garden; the swimming pool is not on the roof.
- Only offer units whose status is available. If they asked about a unit that is reserved or sold, say so kindly and suggest the closest available ones.
- Only use links that appear in the FACTS block.
- Never say or hint that the reply was written by AI.

WHAT TO WRITE
- email_subject and email_body: 90 to 180 words of plain text in short paragraphs (no markdown; a list line starts with "- "). Greet them by first name. Answer what they actually asked first. Then suggest up to three available units that fit them, one line each: unit number, type, floor, size, list price, and the offer prices while an offer runs, followed by the unit's link on the next line. The SUGGESTED UNITS block lists good choices; use them unless their words point to better ones. Mention the reservation fee and that unit's reserve link only if they seem ready to go ahead. Then ask at most three short questions that help the team understand them (budget, paying in full or on a plan, when they want to buy, to live in or to rent out), skipping anything they already told you. Offer a site visit or a video call. End with "Kind regards," then "The Lexington sales team" and the phone number, each on its own line.
- whatsapp_text: the same reply in at most 70 words as one paragraph, with at most one link.
- Give sizes in square metres; when the person is in the USA or Canada (a +1 phone number, or they say so) add square feet in brackets, copied from the facts.
- Write in the language they wrote in.

ALSO
- temperature: "hot" only for a clear sign they want to act soon: they name a specific unit, ask to visit or for a video call, ask how to pay or reserve, or say they want to buy within a month. A budget answer on a form, or saying it is a home to live in, is not enough on its own: that is "warm". "cold" if it looks like spam, a wrong number, an agent or someone selling something, or they say they are just exploring. temperature_reason: one short sentence saying why.
- needs_owner: the questions only the owner can answer, as short phrases. An empty list when there are none.`;

export const LEAD_REPLY_SCHEMA = {
  type: "object",
  properties: {
    email_subject: { type: "string" },
    email_body: { type: "string" },
    whatsapp_text: { type: "string" },
    temperature: { type: "string", enum: ["hot", "warm", "cold"] },
    temperature_reason: { type: "string" },
    needs_owner: { type: "array", items: { type: "string" } },
  },
  required: ["email_subject", "email_body", "whatsapp_text", "temperature", "temperature_reason", "needs_owner"],
  additionalProperties: false,
} as const;

export interface LeadReplyOut {
  email_subject: string;
  email_body: string;
  whatsapp_text: string;
  temperature: "hot" | "warm" | "cold";
  temperature_reason: string;
  needs_owner: string[];
}

const CHANNEL_WORDS: Record<LeadChannel, string> = {
  website: "the enquiry form on the website",
  facebook: "a Facebook / Instagram lead form",
  manual: "added by the owner (for example from a WhatsApp chat or a call)",
};

/** This person's part of the request (the facts come first, then them). */
export function leadPrompt(pack: FactPack, ctx: LeadContext, picks: UnitFact[]): string {
  const person = [
    `Name: ${ctx.name}`,
    ctx.email ? `Email: ${ctx.email}` : "Email: none given",
    ctx.phone ? `Phone: ${ctx.phone}${usesFeet(ctx) ? " (USA or Canada)" : ""}` : "Phone: none given",
    `Came in through: ${CHANNEL_WORDS[ctx.channel]}`,
    ctx.interest ? `"Interested in" on the form: ${ctx.interest}${ctx.channel === "website" ? " (the form starts on One Bedroom Apartment, so this may not be a real choice)" : ""}` : "",
    ctx.unitNumber ? `Unit noted in the CRM: ${ctx.unitNumber}` : "",
    ctx.message ? `What they wrote:\n"""\n${ctx.message}\n"""` : "",
    ctx.answers?.length ? `Their answers on the form:\n${ctx.answers.map((a) => `- ${a.question}: ${a.answer}`).join("\n")}` : "",
    ctx.history?.length ? `Their timeline so far (oldest first):\n${ctx.history.map((h) => `- ${h}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const suggested = picks.length ? picks.map((u) => `${u.unitNumber} (${u.typeLine}, ${u.floorName})`).join(", ") : "none: nothing available fits what they asked";

  return `FACTS\n${factPackText(pack)}\n\nTHE PERSON\n${person}\n\nSUGGESTED UNITS (picked from what they asked): ${suggested}\n\nWrite the reply.`;
}
