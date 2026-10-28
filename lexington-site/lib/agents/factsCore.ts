/**
 * What the agents may say about The Lexington: the live website data, gathered in
 * one "fact pack", plus the sums made from it (offer prices, square feet).
 *
 * WHY. Every claim in a reply or a post must come from the website's own data
 * (Niko's rule after the "rooftop pool" mistake). So the agents never look facts
 * up for themselves: this pack is the whole of what they are told, and the fact
 * check (factcheck.ts) holds every number they write against the same pack.
 *
 * Left out on purpose: the Invest page's upfront-discount table and 12-month
 * schedule (they conflict with the current offer), rental figures and the yield
 * (no income or return claims), and anything not on the website.
 *
 * Pure: lib/agents/facts.ts loads the data from Sanity; this file only reads it.
 */
import { SQFT_PER_SQM } from "@/lib/area";
import { EXTRAS } from "@/lib/extras";
import { formatUSD } from "@/lib/format";
import { has3DModel } from "@/lib/models3d";
import { RESERVATION_FEE_USD, unitTypeFor } from "@/lib/reservation/config";
import { ESTIMATED_COMPLETION, POSTAL_ADDRESS, SITE_URL } from "@/lib/seo";
import { NO_VAT, feeVatSuffix, vatSuffix, type Vat } from "@/lib/vat";

export interface RawFacts {
  units: Array<{
    unitNumber: string;
    bedroomType: string;
    floor: number;
    areaSqm: number;
    priceUSD: number;
    status: string;
    minPackageTier?: string | null;
  }>;
  promoBanner?: { enabled?: boolean; message?: string } | null;
  contact: { phone: string; email: string; office: string };
  tiers: Array<{ key: string; name: string; ratePerSqm: number; badge?: string | null }>;
  mortgage: { note?: string; rows?: Array<{ milestone: string; timeframe: string; option1: string }> } | null;
  serviceCharge: { description?: string; coveredItems?: string[]; note?: string } | null;
  amenities: Array<{ name: string; category: string }>;
  /** The newest site update posted with the progress reporter, if any. */
  latestUpdate?: { date: string; title?: string; text?: string } | null;
  /** VAT on the prices (Site settings; off until registered). */
  vat?: Vat;
}

export interface OfferFact {
  /** The banner's words, as the website shows them (without the "⚡UPDATE⚡" flourish). */
  text: string;
  fullPaymentPct: number | null;
  planPct: number | null;
  planMonths: number | null;
  /** The last day of the offer (YYYY-MM-DD), when the banner names one. */
  endsOn: string | null;
  /** The banner still shows it, but its last day has passed. */
  ended: boolean;
}

export interface UnitFact {
  unitNumber: string;
  /** As the unit list stores it, e.g. "One Bedroom". */
  type: string;
  /** In words, e.g. "One-bedroom apartment". */
  typeLine: string;
  floor: number;
  floorName: string;
  areaSqm: number;
  areaSqft: number;
  priceUSD: number;
  status: "available" | "reserved" | "sold";
  /** The price with the offer's full-payment discount, while an offer runs (available units only). */
  fullPaymentPriceUSD: number | null;
  /** The price with the offer's payment-plan discount, while an offer runs (available units only). */
  planPriceUSD: number | null;
  /** The unit's pop-up on the Residences page: plan, size, price (and the 3D plan where there is one). */
  link: string;
  reserveLink: string;
  has3D: boolean;
  /** The lowest finish the unit is sold with ("Standard", or "Premium" for the penthouses). */
  baseFinish: string;
}

export interface FactPack {
  /** YYYY-MM-DD (UTC: Ghana's own date). */
  today: string;
  units: UnitFact[];
  /** The offer the website banner shows now, or null when none runs. */
  offer: OfferFact | null;
  /** VAT on the prices: while on, every price is before VAT and is written with "+ VAT". */
  vat: Vat;
  reservationFeeUSD: number;
  finishes: Array<{ name: string; ratePerSqm: number; badge: string | null }>;
  extras: string[];
  mortgage: { note: string; steps: string[] } | null;
  serviceCharge: { description: string; covers: string[]; note: string } | null;
  amenities: { rooftop: string[]; signature: string[]; building: string[] };
  completion: string;
  latestUpdate: { date: string; title: string; text: string } | null;
  contact: { phone: string; email: string; office: string };
  address: string;
  links: { residences: string; reserve: string; gallery: string; amenities: string; progress: string; contact: string };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The offer in the website banner, read from its words, e.g. "Phase 1 pricing ends
 * 31st of October — 15% off with full payment or 8% off with flexible payment plans
 * up to 18 months." A number the words don't clearly give stays null (and is then
 * never quoted as a sum). Null when the banner is off or empty.
 */
export function parseOffer(message: string | undefined | null, enabled: boolean | undefined | null, today: string): OfferFact | null {
  if (!enabled || !message?.trim()) return null;
  const text = message
    .replace(/⚡\s*update\s*⚡/gi, "")
    .replace(/⚡/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const full = /(\d{1,2}(?:\.\d+)?)\s*%\s*off\s+(?:with|for|on|when\s+paying)\s+(?:a\s+)?(?:full\s+payment|paying\s+in\s+full|payment\s+in\s+full)/i.exec(text);
  const plan = /(\d{1,2}(?:\.\d+)?)\s*%\s*off\s+(?:with|for|on)\s+[^.%]*?payment\s+plans?(?:[^.%]*?up\s+to\s+(\d{1,2})\s+months?)?/i.exec(text);
  const end = /ends?\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:,?\s+(\d{4}))?/i.exec(text);

  let endsOn: string | null = null;
  if (end) {
    const month = MONTHS.findIndex((m) => m.startsWith(end[2].toLowerCase().slice(0, 3)));
    const day = Number(end[1]);
    if (month >= 0 && day >= 1 && day <= 31) {
      const year = end[3] ? Number(end[3]) : Number(today.slice(0, 4));
      const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
      // A real calendar day only ("31 September" is not one).
      if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso) endsOn = iso;
    }
  }

  return {
    text,
    fullPaymentPct: full ? Number(full[1]) : null,
    planPct: plan ? Number(plan[1]) : null,
    planMonths: plan?.[2] ? Number(plan[2]) : null,
    endsOn,
    ended: endsOn !== null && endsOn < today,
  };
}

/** A price less a percentage, to the whole dollar. */
export function discounted(priceUSD: number, pct: number): number {
  return Math.round((priceUSD * (100 - pct)) / 100);
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function floorName(floor: number): string {
  return floor === 0 ? "ground floor" : `${ordinal(floor)} floor`;
}

export function sqft(sqm: number): number {
  return Math.round(sqm * SQFT_PER_SQM);
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1].replace(/^./, (c) => c.toUpperCase())} ${y}`;
}

const STATUSES = ["available", "reserved", "sold"] as const;

export function buildFactPack(raw: RawFacts, today: string): FactPack {
  const parsed = parseOffer(raw.promoBanner?.message, raw.promoBanner?.enabled, today);
  // An offer whose last day has passed is not offered to anyone, whatever the banner still says.
  const offer = parsed && !parsed.ended ? parsed : null;

  const tierName = (key: string | null | undefined) => raw.tiers.find((t) => t.key === (key || "standard"))?.name ?? "Standard";

  const units: UnitFact[] = raw.units.map((u) => {
    const status = (STATUSES as readonly string[]).includes(u.status) ? (u.status as UnitFact["status"]) : "sold";
    const open = status === "available";
    const q = encodeURIComponent(u.unitNumber);
    return {
      unitNumber: u.unitNumber,
      type: u.bedroomType,
      typeLine: unitTypeFor(u.bedroomType)?.line ?? u.bedroomType,
      floor: u.floor,
      floorName: floorName(u.floor),
      areaSqm: u.areaSqm,
      areaSqft: sqft(u.areaSqm),
      priceUSD: u.priceUSD,
      status,
      fullPaymentPriceUSD: open && offer?.fullPaymentPct != null ? discounted(u.priceUSD, offer.fullPaymentPct) : null,
      planPriceUSD: open && offer?.planPct != null ? discounted(u.priceUSD, offer.planPct) : null,
      link: `${SITE_URL}/residences?unit=${q}`,
      reserveLink: `${SITE_URL}/reserve?unit=${q}`,
      has3D: has3DModel(u.unitNumber),
      baseFinish: tierName(u.minPackageTier),
    };
  });

  const mortgageSteps = (raw.mortgage?.rows ?? []).map((r) => `${r.milestone}: ${r.option1} (${r.timeframe})`);
  const byCategory = (category: string) => raw.amenities.filter((a) => a.category === category).map((a) => a.name);

  return {
    today,
    units,
    offer,
    vat: raw.vat ?? NO_VAT,
    reservationFeeUSD: RESERVATION_FEE_USD,
    finishes: raw.tiers.map((t) => ({ name: t.name, ratePerSqm: t.ratePerSqm, badge: t.badge ?? null })),
    extras: EXTRAS.map((e) => e.title),
    mortgage: raw.mortgage?.note || mortgageSteps.length ? { note: raw.mortgage?.note ?? "", steps: mortgageSteps } : null,
    serviceCharge: raw.serviceCharge?.description
      ? {
          description: raw.serviceCharge.description,
          covers: raw.serviceCharge.coveredItems ?? [],
          note: raw.serviceCharge.note ?? "",
        }
      : null,
    amenities: { rooftop: byCategory("rooftop"), signature: byCategory("signature"), building: byCategory("building feature") },
    completion: `${ESTIMATED_COMPLETION.monthName} ${ESTIMATED_COMPLETION.year} (an estimate)`,
    latestUpdate: raw.latestUpdate?.date
      ? { date: raw.latestUpdate.date, title: raw.latestUpdate.title ?? "", text: raw.latestUpdate.text ?? "" }
      : null,
    contact: raw.contact,
    address: `${POSTAL_ADDRESS.streetAddress}, ${POSTAL_ADDRESS.addressLocality}, Accra, Ghana`,
    links: {
      residences: `${SITE_URL}/residences`,
      reserve: `${SITE_URL}/reserve`,
      gallery: `${SITE_URL}/gallery`,
      amenities: `${SITE_URL}/amenities`,
      progress: `${SITE_URL}/progress`,
      contact: `${SITE_URL}/contact`,
    },
  };
}

/** The pack as the plain text Claude is given. Everything a reply may say is in here. */
export function factPackText(pack: FactPack): string {
  const lines: string[] = [];
  const add = (...more: string[]) => lines.push(...more);

  add(`TODAY: ${longDate(pack.today)}`, "");
  add(
    "THE BUILDING",
    `- The Lexington, ${pack.address}. Eight storeys of homes for sale: studios, one-, two- and three-bedroom apartments and duplex penthouses.`,
    `- Under construction. Estimated completion: ${pack.completion}.`,
    `- Photos of the building work so far: ${pack.links.progress}`
  );
  if (pack.latestUpdate) {
    add(`- Latest site update (${longDate(pack.latestUpdate.date)}): ${[pack.latestUpdate.title, pack.latestUpdate.text].filter(Boolean).join(". ")}`);
  }
  add("");

  if (pack.offer) {
    const o = pack.offer;
    add(`CURRENT OFFER (the website banner, word for word): "${o.text}"`);
    if (o.fullPaymentPct != null) add(`- Paying in full: ${o.fullPaymentPct}% off the list price (the "offer price, full payment" column below).`);
    if (o.planPct != null) {
      add(`- Payment plan${o.planMonths ? ` of up to ${o.planMonths} months` : ""}: ${o.planPct}% off the list price (the "offer price, plan" column below).`);
    }
    if (o.endsOn) add(`- Last day: ${longDate(o.endsOn)}.`);
  } else {
    add("CURRENT OFFER: none is running now. Do not mention any discount.");
  }
  add("");

  add(
    "RESERVING",
    `- A reservation fee of ${formatUSD(pack.reservationFeeUSD)}${feeVatSuffix(pack.vat)} holds a residence. Each available unit has its own reserve link below; the general one is ${pack.links.reserve}`,
    "- After a reservation request, the sales team agrees with the buyer how they will pay and then sends the matching bank details themselves.",
    ""
  );

  add("PAYING");
  if (pack.offer?.planPct != null) {
    add(
      `- In full, or on a payment plan${pack.offer.planMonths ? ` of up to ${pack.offer.planMonths} months` : ""}. The sales team sets out each buyer's payment schedule.`
    );
  } else {
    add("- In full or on a payment plan. The sales team sets out each buyer's payment schedule.");
  }
  if (pack.mortgage) {
    add(`- Mortgage: ${pack.mortgage.note}${pack.mortgage.steps.length ? ` Steps: ${pack.mortgage.steps.join("; ")}.` : ""}`);
  }
  add("");

  if (pack.vat.on) {
    add(
      "PRICES AND VAT",
      `- Every price below (units, offer prices, finishes, parking and storage) is in US dollars and BEFORE VAT. VAT is added on top at ${pack.vat.rate}% (VAT 15%, NHIL 2.5%, GETFund 2.5%). Whenever you give one of these prices, write "+ VAT" right after it, e.g. "$120,000 + VAT". Never work out the VAT or a total yourself; the website's unit pop-up shows them.`,
      `- The ${formatUSD(pack.reservationFeeUSD)} reservation fee already includes VAT: never write "+ VAT" after it ("${formatUSD(pack.reservationFeeUSD)} (VAT included)" is right). Whether or how it comes off the price is for the sales team to explain (no terms for that are given).`,
      ""
    );
  }
  add(`FINISHES (added to the list price, per square metre of the unit${pack.vat.on ? ", before VAT" : ""})`);
  for (const f of pack.finishes) {
    add(`- ${f.name}${f.badge ? ` (${f.badge})` : ""}: ${f.ratePerSqm > 0 ? `+${formatUSD(f.ratePerSqm)} per m²` : "included in the list price"}`);
  }
  add("- The penthouses are sold with the Premium finish at least (already in their list price).", "");

  add("PARKING AND STORAGE", ...pack.extras.map((e) => `- ${e}`), "");

  add("AMENITIES (use exactly these names; nothing else is offered)");
  if (pack.amenities.rooftop.length) add(`- On the roof: ${pack.amenities.rooftop.join(", ")}. Nothing else is on the roof.`);
  if (pack.amenities.signature.length) add(`- Shared amenities: ${pack.amenities.signature.join(", ")}. (The swimming pool is NOT on the roof.)`);
  if (pack.amenities.building.length) add(`- In the building: ${pack.amenities.building.join(", ")}.`);
  add("");

  if (pack.serviceCharge) {
    add("SERVICE CHARGE", `- ${pack.serviceCharge.description}`);
    if (pack.serviceCharge.covers.length) add(`- It covers: ${pack.serviceCharge.covers.join(", ")}.`);
    if (pack.serviceCharge.note) add(`- ${pack.serviceCharge.note}`);
    add("");
  }

  add(
    `UNITS (only the ones marked available may be offered; prices in US dollars${pack.vat.on ? " before VAT" : ""}, Standard finish unless the unit says Premium)`,
    "unit | type | floor | size | list price | offer price, full payment | offer price, plan | status | link"
  );
  for (const u of pack.units) {
    add(
      [
        u.unitNumber,
        u.typeLine,
        u.floorName,
        `${u.areaSqm} m² (${u.areaSqft} sq ft)`,
        `${formatUSD(u.priceUSD)}${vatSuffix(pack.vat)}${u.baseFinish !== "Standard" ? ` (${u.baseFinish} finish)` : ""}`,
        u.fullPaymentPriceUSD != null ? `${formatUSD(u.fullPaymentPriceUSD)}${vatSuffix(pack.vat)}` : "-",
        u.planPriceUSD != null ? `${formatUSD(u.planPriceUSD)}${vatSuffix(pack.vat)}` : "-",
        u.status,
        u.status === "available" ? `${u.link} (reserve: ${u.reserveLink})${u.has3D ? " (has a 3D plan)" : ""}` : "-",
      ].join(" | ")
    );
  }
  add("");

  add(
    "CONTACT",
    `- Phone and WhatsApp: ${pack.contact.phone}`,
    `- Email: ${pack.contact.email}`,
    `- Sales office: ${pack.contact.office}`,
    `- Pages: all residences ${pack.links.residences} · photos ${pack.links.gallery} · amenities ${pack.links.amenities} · contact ${pack.links.contact}`
  );

  return lines.filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");
}

// ---- the numbers a reply may contain (for the fact check) ------------------

/** Every dollar amount the pack holds or makes: prices, offer prices, fees, rates. */
export function allowedAmounts(pack: FactPack): Set<number> {
  const amounts = new Set<number>([pack.reservationFeeUSD]);
  for (const u of pack.units) {
    amounts.add(u.priceUSD);
    if (u.fullPaymentPriceUSD != null) amounts.add(u.fullPaymentPriceUSD);
    if (u.planPriceUSD != null) amounts.add(u.planPriceUSD);
  }
  for (const f of pack.finishes) amounts.add(f.ratePerSqm);
  for (const e of pack.extras) for (const m of e.matchAll(/\$([\d,]+)/g)) amounts.add(Number(m[1].replace(/,/g, "")));
  for (const step of pack.mortgage?.steps ?? []) for (const m of step.matchAll(/\$([\d,]+)/g)) amounts.add(Number(m[1].replace(/,/g, "")));
  return amounts;
}

/** Every percentage the pack holds: the offer's, and the mortgage terms'. */
export function allowedPercents(pack: FactPack): Set<number> {
  const pcts = new Set<number>([100]);
  if (pack.offer?.fullPaymentPct != null) pcts.add(pack.offer.fullPaymentPct);
  if (pack.offer?.planPct != null) pcts.add(pack.offer.planPct);
  // While VAT is on, its rate and its parts may be named.
  if (pack.vat.on) for (const p of [pack.vat.rate, 15, 2.5]) pcts.add(p);
  const mortgageText = [pack.mortgage?.note ?? "", ...(pack.mortgage?.steps ?? [])].join(" ");
  for (const m of mortgageText.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) pcts.add(Number(m[1]));
  return pcts;
}

/** Every size the pack holds, in m² and in sq ft (the unit sizes and the storage ranges). */
export function allowedAreas(pack: FactPack): { sqm: Set<number>; sqft: Set<number> } {
  const sqm = new Set<number>();
  const sqftSet = new Set<number>();
  for (const u of pack.units) {
    sqm.add(u.areaSqm);
    sqftSet.add(u.areaSqft);
  }
  for (const e of pack.extras) for (const m of e.matchAll(/(\d+)[–-](\d+)\s*sqm/g)) [m[1], m[2]].forEach((n) => sqm.add(Number(n)));
  return { sqm, sqft: sqftSet };
}
