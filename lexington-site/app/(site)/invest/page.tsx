import { offerSchedule } from "@/lib/agents/factsCore";
import { dayMonth, nextOfferLine } from "@/lib/offerText";
import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { financingPlanQuery, galleryImagesQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { FinancingPlan, GalleryImage, SiteSettings } from "@/lib/sanity/types";
import { feeVatSuffix, vatFrom } from "@/lib/vat";

import { PageIntro } from "@/components/PageIntro";
import { OfferBand } from "@/components/OfferBand";
import { SplitSection } from "@/components/SplitSection";
import { Button } from "@/components/Button";
import { Reveal } from "@/components/Reveal";
import { VatIncluded } from "@/components/Vat";
import planTableStyles from "@/components/PlanTable.module.css";

export const revalidate = 600;

export async function generateMetadata() {
  const settings = await client.fetch<SiteSettings>(siteSettingsQuery);
  return pageMetadata({
    path: "/invest",
    title: "Invest & Financing | The Lexington",
    description: `Payment plans, reservation terms and finish packages for buyers at The Lexington in East Legon, Accra. Reserve your unit from $10,000${feeVatSuffix(vatFrom(settings))}.`,
  });
}

// The reservation row's dollar amounts in the payment tables: the fee has VAT in it (lib/vat.ts).
const isFeeCell = (milestone: string, value?: string) => /reserv/i.test(milestone) && /\$\s?\d/.test(value ?? "");

export default async function InvestPage() {
  const [financingPlan, images, siteSettings] = await Promise.all([
    client.fetch<FinancingPlan>(financingPlanQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
  ]);

  const vat = vatFrom(siteSettings);
  const rentalImage = images.find((i) => i.category === "interior");
  // The current offer (site settings → "Current offer"): shown while it is switched on and its last day
  // has not passed (Accra is on UTC), the same test the lead replies and the ads use. From the day after
  // its last day, the next offer set there takes over by itself (Niko, 17 Nov 2026: 15% / 8% until
  // 30 November, then "10% full payment, 5% payment plan from 1 Dec").
  const schedule = offerSchedule(siteSettings.promoBanner, new Date().toISOString().slice(0, 10));
  const offer = schedule.now && !schedule.now.ended ? schedule.now : null;
  const next = offer ? schedule.next : null;
  // The Discounts table: one column for the offer, and one for the smaller discounts that follow it.
  const columns = offer ? [offer, ...(next ? [next] : [])] : [];
  const discountRows = offer
    ? [
        { label: "Paying in full", pcts: columns.map((o) => o.fullPaymentPct) },
        {
          label: `On a flexible payment plan${(offer.planMonths ?? next?.planMonths) ? `, up to ${offer.planMonths ?? next?.planMonths} months` : ""}`,
          pcts: columns.map((o) => o.planPct),
        },
      ].filter((row) => row.pcts.some((p) => p != null))
    : [];

  return (
    <>
      <PageIntro {...siteSettings.investIntro} />

      {offer && <OfferBand message={offer.text} limited={Boolean(offer.endsOn)} after={next ? nextOfferLine(next) : null} />}

      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Financing Options</div>
            <h2 style={{ fontSize: "var(--fs-600)", marginTop: 14 }}>
              Self-finance payment plans.
            </h2>
            <p style={{ marginTop: 16, color: "#555", maxWidth: 640 }}>
              All financing options are flexible with the exception of a
              minimum $10,000 reservation{feeVatSuffix(vat)} — contact us for a
              custom package.
            </p>
          </Reveal>

          <div className={planTableStyles.tableScroll} style={{ marginTop: 40 }}>
            <table className={planTableStyles.table}>
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Timeframe</th>
                  <th>Option 1</th>
                  <th>Option 2</th>
                </tr>
              </thead>
              <tbody>
                {financingPlan.selfFinanceRows.map((row) => (
                  <tr key={row.milestone}>
                    <td>{row.milestone}</td>
                    <td>{row.timeframe}</td>
                    <td>
                      {row.option1}
                      {isFeeCell(row.milestone, row.option1) && <VatIncluded vat={vat} />}
                    </td>
                    <td>
                      {row.option2 || "—"}
                      {isFeeCell(row.milestone, row.option2) && <VatIncluded vat={vat} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="eyebrow" style={{ marginTop: 56 }}>
            Mortgage Financing
          </div>
          <p style={{ marginTop: 12, color: "#555", maxWidth: 620, fontSize: 15 }}>
            {financingPlan.mortgageNote}
          </p>
          <div className={planTableStyles.tableScroll} style={{ marginTop: 20 }}>
            <table className={planTableStyles.table}>
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Timeframe</th>
                  <th>Option 1</th>
                </tr>
              </thead>
              <tbody>
                {financingPlan.mortgageRows.map((row) => (
                  <tr key={row.milestone}>
                    <td>{row.milestone}</td>
                    <td>{row.timeframe}</td>
                    <td>
                      {row.option1}
                      {isFeeCell(row.milestone, row.option1) && <VatIncluded vat={vat} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The discounts come from the offer in Site settings, the same words the replies, the chat and the ads
              use (the old upfront-payment tiers, 12.5% down to 5%, contradicted the offer and are no longer shown). */}
          {discountRows.length > 0 && offer && (
            <>
              <div className="eyebrow" style={{ marginTop: 56 }}>
                Discounts
              </div>
              <p style={{ marginTop: 12, color: "#555", maxWidth: 620, fontSize: 15 }}>
                {next && offer.endsOn
                  ? `Off the list price. The current offer runs until ${dayMonth(offer.endsOn)}; from ${dayMonth(next.startsOn)} the discounts are smaller.`
                  : "Off the list price, for paying in full or on a flexible payment plan."}
              </p>
              <div className={planTableStyles.tableScroll} style={{ marginTop: 20 }}>
                <table className={planTableStyles.table}>
                  <thead>
                    <tr>
                      <th>How you pay</th>
                      {next && offer.endsOn ? (
                        <>
                          <th>Until {dayMonth(offer.endsOn)}</th>
                          <th>From {dayMonth(next.startsOn)}</th>
                        </>
                      ) : (
                        <th>Discount</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {discountRows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        {row.pcts.map((p, i) => (
                          <td key={i} className={planTableStyles.discount}>
                            {p != null ? `${p}%` : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="section sectionStone" style={{ background: "var(--stone-lt)" }}>
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Ongoing Costs</div>
            <h2 style={{ fontSize: "var(--fs-600)", marginTop: 14 }}>
              A monthly building management fee.
            </h2>
            <p style={{ marginTop: 16, color: "#555", maxWidth: 620 }}>
              {financingPlan.serviceCharge.description}
            </p>
          </Reveal>

          <div
            style={{
              marginTop: 40,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "12px 40px",
              maxWidth: 620,
            }}
          >
            {financingPlan.serviceCharge.coveredItems.map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 15 }}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  style={{ flex: "none", marginTop: 4, color: "var(--brass)" }}
                  aria-hidden="true"
                >
                  <path
                    d="M3 8.5L6.2 11.5L13 4.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {item}
              </div>
            ))}
          </div>

          <p
            className="disclaimer"
            style={{
              marginTop: 28,
              maxWidth: 620,
              borderLeft: "2px solid var(--clay)",
              paddingLeft: 14,
              color: "var(--clay)",
            }}
          >
            {financingPlan.serviceCharge.note}
          </p>
        </div>
      </section>

      {rentalImage && (
        <SplitSection
          imageUrl={urlFor(rentalImage.image).width(800).height(1000).url()}
          imageAlt={rentalImage.alt}
          reverse
          eyebrow="Buy to Rent"
          title="An in-house rentals team, from day one."
        >
          <p>
            Full management of your investment, handled by a dedicated
            rentals and building management team.
          </p>
          <ul
            style={{
              marginTop: 28,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              listStyle: "none",
              padding: 0,
            }}
          >
            <li style={{ fontFamily: "var(--font-serif)", fontSize: 19 }}>
              {financingPlan.buyToRent.oneBedroomRange.replace("/mo", "")} — 1 Bedroom rental*
            </li>
            <li style={{ fontFamily: "var(--font-serif)", fontSize: 19 }}>
              {financingPlan.buyToRent.twoBedroomRange.replace("/mo", "")} — 2 Bedroom rental*
            </li>
            <li style={{ fontFamily: "var(--font-serif)", fontSize: 19, color: "var(--clay)" }}>
              {financingPlan.buyToRent.projectedYieldPct}% projected rental yield
            </li>
          </ul>
          <p className="disclaimer" style={{ marginTop: 20 }}>
            *All rentals based on square meterage and unit location.
          </p>
        </SplitSection>
      )}

      <section className="section sectionStone" style={{ textAlign: "center", background: "var(--stone)" }}>
        <div className="wrap">
          <Reveal>
            <div className="eyebrow" style={{ justifyContent: "center", display: "flex" }}>
              Next Step
            </div>
            <h2 style={{ marginTop: 14, fontSize: "var(--fs-600)" }}>
              Discuss your custom package.
            </h2>
            <p style={{ maxWidth: 560, margin: "18px auto 0", color: "#555", fontSize: 16.5 }}>
              Every financing option is flexible beyond the minimum $10,000
              reservation{feeVatSuffix(vat)}. Tell us what you need.
            </p>
            <div style={{ marginTop: 32 }}>
              <Button href="/contact" variant="brass">
                Contact Us
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
