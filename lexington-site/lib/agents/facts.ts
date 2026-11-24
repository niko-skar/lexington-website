import "server-only";

import { todayISO } from "@/lib/crm";
import { client } from "@/lib/sanity/client";
import { vatFrom, type VatSetting } from "@/lib/vat";

import { buildFactPack, type FactPack, type RawFacts } from "./factsCore";

// Everything the agents may quote, read fresh from the published website data each
// time (never a cached copy: a unit reserved this morning must not be offered).
const FACTS_QUERY = `{
  "units": *[_type == "unit"] | order(floor asc, unitNumber asc) {
    unitNumber, bedroomType, floor, areaSqm, balconySqm, terraceSqm, priceUSD, status, minPackageTier
  },
  "settings": *[_type == "siteSettings"][0]{ promoBanner, contactPhone, contactEmail, officeAddress, vat },
  "tiers": *[_type == "packageTiers"][0].tiers[]{ key, name, ratePerSqm, badge },
  // No payment percentages (Niko, 24 Nov 2026: "$10k reservation should be the standard deposit, remove anything that
  // mentions 20% or other"): the mortgage's note only, not its 30% / 70% steps.
  "finance": *[_type == "financingPlan"][0]{ mortgageNote, serviceCharge },
  "amenities": *[_type == "amenity"] | order(order asc) { name, category },
  "latest": *[_type == "progressReport"] | order(date desc, _createdAt desc)[0]{ date, title, text }
}`;

interface FactsResult {
  units: RawFacts["units"] | null;
  settings: {
    promoBanner?: RawFacts["promoBanner"];
    contactPhone?: string;
    contactEmail?: string;
    officeAddress?: string;
    vat?: VatSetting | null;
  } | null;
  tiers: RawFacts["tiers"] | null;
  finance: {
    mortgageNote?: string;
    serviceCharge?: RawFacts["serviceCharge"];
  } | null;
  amenities: RawFacts["amenities"] | null;
  latest: RawFacts["latestUpdate"];
}

export async function loadFactPack(): Promise<FactPack> {
  const r = await client.fetch<FactsResult>(FACTS_QUERY, {}, { cache: "no-store" });
  return buildFactPack(
    {
      units: r.units ?? [],
      promoBanner: r.settings?.promoBanner ?? null,
      contact: {
        phone: r.settings?.contactPhone ?? "",
        email: r.settings?.contactEmail ?? "",
        office: r.settings?.officeAddress ?? "",
      },
      tiers: r.tiers ?? [],
      mortgage: r.finance ? { note: r.finance.mortgageNote } : null,
      serviceCharge: r.finance?.serviceCharge ?? null,
      amenities: r.amenities ?? [],
      latestUpdate: r.latest ?? null,
      vat: vatFrom(r.settings),
    },
    todayISO()
  );
}
