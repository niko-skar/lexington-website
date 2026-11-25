import "server-only";

import { client } from "@/lib/sanity/client";
import { financingPlanQuery, packageTiersQuery, siteSettingsQuery, unitsQuery } from "@/lib/sanity/queries";
import type { FinancingPlan, PackageTiers, SiteSettings, Unit } from "@/lib/sanity/types";

import { buildPriceList, type PriceListData } from "./data";

/** The price list from the live website data, as of today (Accra is on UTC). */
export async function loadPriceList(): Promise<PriceListData> {
  const [units, tiers, settings, plan] = await Promise.all([
    client.fetch<Unit[]>(unitsQuery),
    client.fetch<PackageTiers | null>(packageTiersQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
    client.fetch<FinancingPlan | null>(financingPlanQuery),
  ]);
  return buildPriceList(
    { units: units ?? [], tiers: tiers?.tiers ?? [], settings, mortgageNote: plan?.mortgageNote ?? null },
    new Date().toISOString().slice(0, 10)
  );
}
