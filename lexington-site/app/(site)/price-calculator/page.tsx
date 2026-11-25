import { PageIntro } from "@/components/PageIntro";
import { PriceCalculator } from "@/components/PriceCalculator";
import { mortgagePctFrom } from "@/lib/calculator";
import { calcHomesFrom, calcOfferFrom } from "@/lib/calculatorHomes";
import { RESERVATION_FEE_USD } from "@/lib/reservation/config";
import { client } from "@/lib/sanity/client";
import { financingPlanQuery, packageTiersQuery, siteSettingsQuery, unitsQuery } from "@/lib/sanity/queries";
import type { FinancingPlan, PackageTiers, SiteSettings, Unit } from "@/lib/sanity/types";
import { pageMetadata } from "@/lib/seo";
import { vatFrom } from "@/lib/vat";

export const revalidate = 600;

export const metadata = pageMetadata({
  path: "/price-calculator",
  title: "Price Calculator | The Lexington",
  description:
    "Work out what you would pay for a home at The Lexington in East Legon, Accra, or compare up to four: today's discount, the $10,000 deposit, monthly or quarterly payments, a mortgage and the monthly building fee.",
});

/**
 * The price calculator, a page of its own (Niko, 25 Nov 2026): it starts with the homes still for sale, then how to pay,
 * then each picked home's figures side by side. Reached from How to Buy, a home's pop-up (?unit=) and Residences'
 * Compare (?units=).
 */
export default async function PriceCalculatorPage() {
  const [units, packageTiers, settings, plan] = await Promise.all([
    client.fetch<Unit[]>(unitsQuery),
    client.fetch<PackageTiers | null>(packageTiersQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
    client.fetch<FinancingPlan | null>(financingPlanQuery),
  ]);
  const vat = vatFrom(settings);
  const tiers = packageTiers?.tiers ?? [];

  return (
    <>
      <PageIntro
        eyebrow="Price calculator"
        title="Work out your payments."
        lede={`Pick any home, or up to four to compare, then choose how you would pay: in full, on a payment plan with monthly or quarterly payments, or with a mortgage.${vat.on ? " Prices include VAT." : ""}`}
      />
      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <PriceCalculator
            homes={calcHomesFrom(units ?? [], tiers, vat)}
            tiers={tiers.map((t) => ({ key: t.key, name: t.name }))}
            offer={calcOfferFrom(settings.promoBanner, new Date().toISOString().slice(0, 10))}
            mortgagePct={mortgagePctFrom(plan?.mortgageNote)}
            deposit={RESERVATION_FEE_USD}
            vatOn={vat.on}
            contactPhone={settings.contactPhone}
          />
        </div>
      </section>
    </>
  );
}
