import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { financingPlanQuery, galleryImagesQuery } from "@/lib/sanity/queries";
import type { FinancingPlan, GalleryImage } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { PaymentStepper } from "@/components/PaymentStepper";
import { SplitSection } from "@/components/SplitSection";
import { Button } from "@/components/Button";
import { Reveal } from "@/components/Reveal";
import planTableStyles from "@/components/PlanTable.module.css";

export const revalidate = 60;

export const metadata = {
  title: "Invest & Financing | The Lexington",
};

export default async function InvestPage() {
  const [financingPlan, images] = await Promise.all([
    client.fetch<FinancingPlan>(financingPlanQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
  ]);

  const rentalImage = images.find((i) =>
    i.alt.toLowerCase().includes("rental")
  );

  return (
    <>
      <PageIntro
        eyebrow="Why Invest"
        title="A legacy asset, not just a purchase."
        lede="Situated in a prime and highly desirable location, The Lexington offers an exceptional investment opportunity with the potential for consistent demand and a foundation for strong, long-term returns."
      />

      <section className="section sectionDark" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Financing Options</div>
            <h2 style={{ fontSize: "var(--fs-600)", marginTop: 14 }}>
              Self-finance payment plans.
            </h2>
            <p style={{ marginTop: 16, color: "var(--stone)", maxWidth: 640 }}>
              All financing options are flexible with the exception of a
              minimum $10,000 reservation — contact us for a custom package.
            </p>
          </Reveal>

          <div style={{ marginTop: 48 }}>
            <PaymentStepper rows={financingPlan.selfFinanceRows} />
          </div>

          <div className={planTableStyles.tableScroll}>
            <table className={planTableStyles.table}>
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Timeframe</th>
                  <th>Option 1</th>
                  <th>Option 2</th>
                  <th>Upfront Payment</th>
                  <th>Discount</th>
                </tr>
              </thead>
              <tbody>
                {financingPlan.selfFinanceRows.map((row) => (
                  <tr key={row.milestone}>
                    <td>{row.milestone}</td>
                    <td>{row.timeframe}</td>
                    <td>{row.option1}</td>
                    <td>{row.option2 || "—"}</td>
                    <td>{row.upfrontPayment}</td>
                    <td className={planTableStyles.discount}>{row.discount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="eyebrow" style={{ marginTop: 56 }}>
            Mortgage Financing
          </div>
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
                    <td>{row.option1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      <section className="section sectionDark" style={{ textAlign: "center" }}>
        <div className="wrap">
          <Reveal>
            <div className="eyebrow" style={{ justifyContent: "center", display: "flex" }}>
              Next Step
            </div>
            <h2 style={{ marginTop: 14, color: "var(--paper)", fontSize: "var(--fs-600)" }}>
              Discuss your custom package.
            </h2>
            <p style={{ maxWidth: 560, margin: "18px auto 0", color: "var(--stone)", fontSize: 16.5 }}>
              Every financing option is flexible beyond the minimum $10,000
              reservation. Tell us what you need.
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
