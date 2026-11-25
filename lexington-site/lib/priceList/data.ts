import { offerSchedule, type OfferFact } from "@/lib/agents/factsCore";
import { formatArea } from "@/lib/area";
import { extrasFor } from "@/lib/extras";
import { formatFloor, formatUSD } from "@/lib/format";
import { nextOfferLine, splitOffer } from "@/lib/offerText";
import { floorTierName, isTierClamped, priceAtTier } from "@/lib/pricing";
import { RESERVATION_FEE_USD } from "@/lib/reservation/config";
import type { PackageTier, SiteSettings, Unit } from "@/lib/sanity/types";
import { SITE_URL } from "@/lib/seo";
import { feeVatSuffix, vatFrom, withVat } from "@/lib/vat";

import { PRICE_LIST_PATH } from "./path";

/**
 * The price list a visitor asks for on the website (Niko, 25 Nov 2026: "do 3 from the plan", a "Send me the price list"
 * for people not ready to talk). Built from the live data every time, so it is never out of date: only the homes still
 * for sale, with the price the website shows (Standard finish, VAT included while VAT is on), the offer running today
 * and the one after it, the finishes, parking and storage, and how to pay ($10,000 is the standard deposit, no
 * payment percentages: Niko, 24 Nov 2026). Pure: the server reads the data (loadPriceList), this lays it out, the PDF and
 * the email draw it.
 */

export interface PriceListHome {
  unitNumber: string;
  floor: string;
  /** "70 sqm · 753 sq ft" */
  size: string;
  /** As the website shows it. */
  price: number;
  /** "Premium finish included" for a penthouse. */
  note: string | null;
}

export interface PriceListKind {
  /** "Studios", "One bedroom" … */
  label: string;
  available: number;
  /** The lowest price among those still for sale. */
  from: number | null;
  homes: PriceListHome[];
}

export interface PriceListData {
  /** YYYY-MM-DD */
  issuedOn: string;
  vatOn: boolean;
  /** " incl. VAT" while VAT is on, else "". */
  vatSuffix: string;
  kinds: PriceListKind[];
  available: number;
  total: number;
  offer: { headline: string; detail: string; next: string | null } | null;
  finishes: Array<{ name: string; line: string }>;
  extras: string[];
  paying: string[];
  contact: { phone: string; email: string; address: string };
  links: { residences: string; visit: string; videoTour: string; reserve: string; priceList: string };
}

export interface PriceListRaw {
  units: Unit[];
  tiers: PackageTier[];
  settings: SiteSettings;
  mortgageNote: string | null;
}

/** The kinds of home as a buyer says them, smallest first (as on Residences). */
const KIND_WORDS = ["Studios", "One bedroom", "Two bedrooms", "Three bedrooms", "Duplex penthouses"];

export function kindRank(type: string): number {
  if (/penthouse|duplex/i.test(type)) return 4;
  if (/studio/i.test(type)) return 0;
  if (/\bone\b|\b1\b/i.test(type)) return 1;
  if (/\btwo\b|\b2\b/i.test(type)) return 2;
  if (/\bthree\b|\b3\b/i.test(type)) return 3;
  return 5;
}

export const kindWords = (type: string) => KIND_WORDS[kindRank(type)] ?? type;

/** The download address of the live price list. */
export { PRICE_LIST_PATH };

export function buildPriceList(raw: PriceListRaw, today: string): PriceListData {
  const vat = vatFrom(raw.settings);
  const vatSuffix = vat.on ? " incl. VAT" : "";
  const shown = (u: Unit) => withVat(priceAtTier(u, "standard", raw.tiers), vat);

  const forSale = raw.units.filter((u) => u.status === "available");
  const types = Array.from(new Set(raw.units.map((u) => u.bedroomType))).sort((a, b) => kindRank(a) - kindRank(b) || a.localeCompare(b));
  const kinds: PriceListKind[] = types.map((type) => {
    const homes = forSale
      .filter((u) => u.bedroomType === type)
      .sort((a, b) => shown(a) - shown(b) || a.floor - b.floor || a.unitNumber.localeCompare(b.unitNumber))
      .map((u) => ({
        unitNumber: u.unitNumber,
        floor: formatFloor(u.floor),
        size: `${formatArea(u.areaSqm, "sqm")} · ${formatArea(u.areaSqm, "sqft")}`,
        price: shown(u),
        note: isTierClamped(u, "standard", raw.tiers) ? `${floorTierName(u, raw.tiers)} finish included` : null,
      }));
    return { label: kindWords(type), available: homes.length, from: homes.length ? Math.min(...homes.map((h) => h.price)) : null, homes };
  });

  // The offer running today, and the one after it (the same words the Invest page and the replies use).
  const schedule = offerSchedule(raw.settings.promoBanner, today);
  const now: OfferFact | null = schedule.now && !schedule.now.ended ? schedule.now : null;
  const offer = now
    ? { ...splitOffer(now.text), next: schedule.next ? nextOfferLine(schedule.next) : null }
    : null;
  const planMonths = schedule.now?.planMonths ?? schedule.next?.planMonths ?? null;

  const fee = `${formatUSD(RESERVATION_FEE_USD)} reservation${feeVatSuffix(vat)}`;
  const paying = [
    `The ${fee} is the standard deposit, and it holds your home.`,
    `Pay the rest in full, or on a payment plan${planMonths ? ` of up to ${planMonths} months` : ""}.`,
    ...(raw.mortgageNote ? [`${raw.mortgageNote.trim()} The deposit is the same ${fee}.`] : []),
  ];

  const finishes = raw.tiers.map((t) => ({
    name: t.name,
    line: t.ratePerSqm === 0 ? "Included in every home" : `+${formatUSD(withVat(t.ratePerSqm, vat))} per sqm${vatSuffix}`,
  }));

  return {
    issuedOn: today,
    vatOn: vat.on,
    vatSuffix,
    kinds,
    available: forSale.length,
    total: raw.units.length,
    offer,
    finishes,
    extras: extrasFor(vat).map((e) => e.title),
    paying,
    contact: { phone: raw.settings.contactPhone ?? "", email: raw.settings.contactEmail ?? "", address: raw.settings.officeAddress ?? "" },
    links: {
      residences: `${SITE_URL}/residences`,
      visit: `${SITE_URL}/visit`,
      videoTour: `${SITE_URL}/visit?kind=video`,
      reserve: `${SITE_URL}/reserve`,
      priceList: `${SITE_URL}${PRICE_LIST_PATH}`,
    },
  };
}

/** "25 November 2026" */
export function longDate(iso: string): string {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** The file's name: "The-Lexington-price-list-25-November-2026.pdf". */
export const priceListFileName = (iso: string) => `The-Lexington-price-list-${longDate(iso).replace(/ /g, "-")}.pdf`;
