import "server-only";

import { todayISO } from "@/lib/crm";
import { client } from "@/lib/sanity/client";

import { buildFactPack, type FactPack, type RawFacts } from "./factsCore";

// Everything the agents may quote, read fresh from the published website data each
// time (never a cached copy: a unit reserved this morning must not be offered).
const FACTS_QUERY = `{
  "units": *[_type == "unit"] | order(floor asc, unitNumber asc) {
    unitNumber, bedroomType, floor, areaSqm, priceUSD, status, minPackageTier
  },
  "settings": *[_type == "siteSettings"][0]{ promoBanner, contactPhone, contactEmail, officeAddress },
  "tiers": *[_type == "packageTiers"][0].tiers[]{ key, name, ratePerSqm, badge },
  "finance": *[_type == "financingPlan"][0]{ mortgageNote, mortgageRows[]{ milestone, timeframe, option1 }, serviceCharge },
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
  } | null;
  tiers: RawFacts["tiers"] | null;
  finance: {
    mortgageNote?: string;
    mortgageRows?: Array<{ milestone: string; timeframe: string; option1: string }>;
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
      mortgage: r.finance ? { note: r.finance.mortgageNote, rows: r.finance.mortgageRows } : null,
      serviceCharge: r.finance?.serviceCharge ?? null,
      amenities: r.amenities ?? [],
      latestUpdate: r.latest ?? null,
    },
    todayISO()
  );
}
