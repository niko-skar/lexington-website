import Link from "next/link";

import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { feeVatSuffix, vatFrom } from "@/lib/vat";

import { PageIntro } from "@/components/PageIntro";
import { ContactForm } from "@/components/ContactForm";
import { InteractiveMap } from "@/components/InteractiveMap";
import { googleMapsUrl } from "@/lib/maps";
import { phoneHref, whatsappUrl } from "@/lib/format";
import buttonStyles from "@/components/Button.module.css";
import styles from "./contact.module.css";

export const revalidate = 600;
// The enquiry form's action runs here, and after answering the visitor it waits
// for the lead responder to write the suggested reply (lib/actions/contact.ts).
export const maxDuration = 120;

export async function generateMetadata() {
  const settings = await client.fetch<SiteSettings>(siteSettingsQuery);
  return pageMetadata({
    path: "/contact",
    title: "Contact & Reserve | The Lexington",
    description: `Arrange a viewing at The Lexington in Shiashie, East Legon, or ask about availability, pricing and payment plans. Reserve from $10,000${feeVatSuffix(vatFrom(settings))}.`,
  });
}

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
                  <a
                    className={styles.whatsapp}
                    href={whatsappUrl(siteSettings.contactPhone, "Hi, I'm interested in The Lexington.")}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Message on WhatsApp
                  </a>
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
                  A minimum $10,000 reservation{feeVatSuffix(vatFrom(siteSettings))} secures
                  your residence. Card and bank-transfer deposit options are
                  available on request.
                </p>
                <p style={{ marginTop: 10 }}>
                  Answer a few questions and we&rsquo;ll email you the
                  reservation form.
                </p>
                <Link
                  href="/reserve"
                  className={`${buttonStyles.btn} ${buttonStyles.brass}`}
                  style={{ marginTop: 18 }}
                >
                  Start a Reservation
                </Link>
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
