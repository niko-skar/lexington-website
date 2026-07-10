import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { ContactForm } from "@/components/ContactForm";
import { InteractiveMap } from "@/components/InteractiveMap";
import { googleMapsUrl } from "@/lib/maps";
import { phoneHref } from "@/lib/format";
import buttonStyles from "@/components/Button.module.css";
import styles from "./contact.module.css";

export const revalidate = 60;

export const metadata = {
  title: "Contact & Reserve | The Lexington",
};

export default async function ContactPage() {
  const siteSettings = await client.fetch<SiteSettings>(siteSettingsQuery);

  return (
    <>
      <PageIntro {...siteSettings.contactIntro} />

      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <div className={styles.grid}>
            <div>
              <div className={styles.detail}>
                <div className={styles.key}>Phone</div>
                <div className={styles.value}>
                  <a href={phoneHref(siteSettings.contactPhone)}>{siteSettings.contactPhone}</a>
                </div>
              </div>
              <div className={styles.detail}>
                <div className={styles.key}>Email</div>
                <div className={styles.value}>
                  <a href={`mailto:${siteSettings.contactEmail}`}>{siteSettings.contactEmail}</a>
                </div>
              </div>
              <div className={styles.detail}>
                <div className={styles.key}>Office</div>
                <div className={styles.value}>
                  <a
                    href={googleMapsUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {siteSettings.officeAddress}
                  </a>
                </div>
              </div>

              <div className={styles.reserveBox}>
                <div className="eyebrow">Reserve a Unit</div>
                <p>
                  A minimum $10,000 reservation secures your residence. Card
                  and bank-transfer deposit options are available on request.
                </p>
                <a
                  href={`mailto:${siteSettings.contactEmail}?subject=Reservation%20Enquiry%20-%20The%20Lexington`}
                  className={`${buttonStyles.btn} ${buttonStyles.brass}`}
                  style={{ marginTop: 18 }}
                >
                  Start a Reservation
                </a>
              </div>
            </div>

            <ContactForm />
          </div>

          <div style={{ marginTop: "var(--space-8)" }}>
            <InteractiveMap />
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
