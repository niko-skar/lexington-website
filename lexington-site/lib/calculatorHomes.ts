import { offerSchedule } from "@/lib/agents/factsCore";
import { formatArea } from "@/lib/area";
import { formatFloor } from "@/lib/format";
import { dayMonth, nextOfferLine } from "@/lib/offerText";
import { floorTierName, isTierClamped, priceAtTier } from "@/lib/pricing";
import { kindRank, kindWords } from "@/lib/priceList/data";
import type { PackageTier, SiteSettings, Unit } from "@/lib/sanity/types";
import { withVat, type Vat } from "@/lib/vat";

/** A home the price calculator can work out (one still for sale). */
export interface CalcHome {
  unitNumber: string;
  /** The group it is listed under: "Studios", "One bedroom", "Duplex penthouses". */
  kind: string;
  /** This home's type as the rest of the site words it: "Studio", "One Bedroom". */
  type: string;
  /** "Floor 2", "Ground floor" */
  floor: string;
  areaSqm: number;
  /** "70 sqm · 753 sq ft" */
  size: string;
  /** The price shown for each finish (VAT included while VAT is on); a penthouse's lower finishes give its own. */
  prices: Record<string, number>;
  /** "Premium finish included as standard" for a home that can't have less, else null. */
  includedNote: string | null;
  /** The lowest finish this home comes with ("premium" for a penthouse), else null. */
  minTier: string | null;
}

/** The offer running today, as the calculator uses it. */
export interface CalcOffer {
  fullPct: number | null;
  planPct: number | null;
  /** "30 November", when the offer has a last day. */
  until: string | null;
  /** "From 1 December: 10% off with full payment, or 5% off with a payment plan." */
  nextLine: string | null;
}

/** Every home still for sale, by kind (smallest first) then price, as the calculator lists them (25 Nov 2026). */
export function calcHomesFrom(units: readonly Unit[], tiers: readonly PackageTier[], vat: Vat): CalcHome[] {
  const list = [...tiers];
  return units
    .filter((u) => u.status === "available")
    .sort((a, b) => kindRank(a.bedroomType) - kindRank(b.bedroomType) || priceAtTier(a, "standard", list) - priceAtTier(b, "standard", list) || a.unitNumber.localeCompare(b.unitNumber))
    .map((u) => {
      const clamped = list.length > 0 && isTierClamped(u, list[0].key, list);
      return {
        unitNumber: u.unitNumber,
        kind: kindWords(u.bedroomType),
        type: u.bedroomType,
        floor: u.floor === 0 ? "Ground floor" : `Floor ${formatFloor(u.floor)}`,
        areaSqm: u.areaSqm,
        size: `${formatArea(u.areaSqm, "sqm")} · ${formatArea(u.areaSqm, "sqft")}`,
        prices: Object.fromEntries(list.map((t) => [t.key, withVat(priceAtTier(u, t.key, list), vat)])),
        includedNote: clamped ? `${floorTierName(u, list)} finish included as standard` : null,
        minTier: clamped ? (list.find((t) => t.name === floorTierName(u, list))?.key ?? null) : null,
      };
    });
}

/** Today's discounts (the same offer as the Invest page, the replies and the ads), or null when none is running. */
export function calcOfferFrom(promoBanner: SiteSettings["promoBanner"], today: string): CalcOffer | null {
  const schedule = offerSchedule(promoBanner, today);
  const offer = schedule.now && !schedule.now.ended ? schedule.now : null;
  if (!offer) return null;
  return {
    fullPct: offer.fullPaymentPct,
    planPct: offer.planPct,
    until: offer.endsOn ? dayMonth(offer.endsOn) : null,
    nextLine: schedule.next ? nextOfferLine(schedule.next) : null,
  };
}
