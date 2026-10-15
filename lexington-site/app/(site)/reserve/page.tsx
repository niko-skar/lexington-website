import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery, unitOptionsQuery } from "@/lib/sanity/queries";
import type { SiteSettings, UnitStatus } from "@/lib/sanity/types";
import { RESERVATION_FEE_USD } from "@/lib/reservation/config";
import { phoneHref, whatsappUrl } from "@/lib/format";

import { PageIntro } from "@/components/PageIntro";
import { ReserveForm, type ReserveUnit } from "@/components/ReserveForm";
import styles from "./reserve.module.css";

export const revalidate = 300;

export const metadata = pageMetadata({
  path: "/reserve",
  title: "Reserve a Residence | The Lexington",
  description:
    "Answer a few questions and we'll email you the reservation fee form. Reserve your residence at The Lexington in Shiashie, East Legon from $10,000.",
});

type UnitRow = ReserveUnit & { status: UnitStatus };

export default async function ReservePage() {
  const [siteSettings, allUnits] = await Promise.all([
    client.fetch<SiteSettings>(siteSettingsQuery),
    client.fetch<UnitRow[]>(unitOptionsQuery),
  ]);

  // Only what can still be reserved; the server checks again when the form is sent.
  const units: ReserveUnit[] = allUnits
    .filter((u) => u.status === "available")
    .map(({ unitNumber, bedroomType, floor, areaSqm, priceUSD }) => ({ unitNumber, bedroomType, floor, areaSqm, priceUSD }));

  const whatsappHref = whatsappUrl(siteSettings.contactPhone, "Hi, I'd like to reserve a residence at The Lexington.");
  const fee = `US$${RESERVATION_FEE_USD.toLocaleString("en-US")}`;

  return (
    <>
      <PageIntro
        eyebrow="Reserve"
        title="Reserve your residence."
        lede="Answer a few questions and we'll email you the reservation fee form straight away. It takes about two minutes."
      />

      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <div className={styles.grid}>
            <ReserveForm
              units={units}
              contactPhone={siteSettings.contactPhone}
              contactEmail={siteSettings.contactEmail}
              whatsappHref={whatsappHref}
            />

            <aside className={styles.aside} aria-label="What happens next">
              <div className={styles.panel}>
                <div className="eyebrow">What happens next</div>
                <ol className={styles.steps}>
                  <li>Tell us about you and the residence you want.</li>
                  <li>We email you the reservation fee form ({fee}) straight away.</li>
                  <li>A sales advisor contacts you to agree how you would like to pay, and sends you the bank details.</li>
                  <li>We confirm your residence in writing, and your payment receipt follows.</li>
                </ol>
              </div>
              <div className={styles.panel}>
                <div className="eyebrow">Prefer to talk?</div>
                <p className={styles.talk}>
                  <a href={phoneHref(siteSettings.contactPhone)}>{siteSettings.contactPhone}</a>
                </p>
                <p className={styles.talk}>
                  <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                    Message us on WhatsApp
                  </a>
                </p>
                <p className={styles.talk}>
                  <a href={`mailto:${siteSettings.contactEmail}`}>{siteSettings.contactEmail}</a>
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="section sectionAlt">
        <div className="wrap">
          <p className="disclaimer">{siteSettings.disclaimer}</p>
        </div>
      </section>
    </>
  );
}
