import { PageIntro } from "@/components/PageIntro";
import { VisitBooker } from "@/components/visit/VisitBooker";
import { phoneHref, whatsappUrl } from "@/lib/format";
import { googleMapsUrl } from "@/lib/maps";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { pageMetadata } from "@/lib/seo";
import { freeVisitSlots } from "@/lib/siteVisits/store";
import styles from "../reserve/reserve.module.css";

// The free hours change as people book: always worked out fresh (one small query, kept 20 seconds per server).
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  path: "/visit",
  title: "Book a Site Visit | The Lexington",
  description: "Pick a day and a time to see The Lexington in Shiashie, East Legon: Monday to Saturday, 8am to 6pm. Our team will show you the building and the homes.",
});

/** The page's data, and the clock it was read at (for "today" and "tomorrow"). */
async function load() {
  const nowMs = Date.now();
  const [siteSettings, free] = await Promise.all([
    client.fetch<SiteSettings>(siteSettingsQuery),
    freeVisitSlots(nowMs).catch((error) => {
      console.error("[visits] free times could not be read:", error instanceof Error ? error.message : error);
      return [] as string[];
    }),
  ]);
  return { nowMs, siteSettings, free };
}

export default async function VisitPage() {
  const { nowMs, siteSettings, free } = await load();
  const whatsappHref = whatsappUrl(siteSettings.contactPhone, "Hi, I'd like to visit The Lexington.");

  return (
    <>
      <PageIntro
        eyebrow="Visit"
        title="Come and see The Lexington."
        lede="Pick a day and a time, and a member of our team will show you the building and the homes. Monday to Saturday, 8am to 6pm."
      />

      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <div className={styles.grid}>
            <VisitBooker free={free} nowMs={nowMs} address={siteSettings.officeAddress} mapUrl={googleMapsUrl()} whatsappHref={whatsappHref} />

            <aside className={styles.aside} aria-label="About your visit">
              <div className={styles.panel}>
                <div className="eyebrow">Your visit</div>
                <ol className={styles.steps}>
                  <li>Pick a time that suits you. All times are Accra time (GMT).</li>
                  <li>A member of our team meets you at the site and shows you the building and the homes.</li>
                  <li>A visit takes about an hour. It&rsquo;s a building site, so closed shoes are best.</li>
                </ol>
              </div>
              <div className={styles.panel}>
                <div className="eyebrow">Where</div>
                <p className={styles.talk}>{siteSettings.officeAddress}</p>
                <p className={styles.talk}>
                  <a href={googleMapsUrl()} target="_blank" rel="noopener noreferrer">
                    Open the map
                  </a>
                </p>
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
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}
