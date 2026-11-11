import type { Metadata } from "next";
import Link from "next/link";

import { PageIntro } from "@/components/PageIntro";
import { ManageVisit } from "@/components/visit/ManageVisit";
import { whatsappUrl } from "@/lib/format";
import { googleMapsUrl } from "@/lib/maps";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { freeVisitSlots, visitForOwner } from "@/lib/siteVisits/store";
import styles from "../../reserve/reserve.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your Site Visit | The Lexington", robots: { index: false, follow: false } };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** The page's data, and the clock it was read at. */
async function load(id: string, token: string) {
  const nowMs = Date.now();
  const [siteSettings, visit, free] = await Promise.all([
    client.fetch<SiteSettings>(siteSettingsQuery),
    visitForOwner(id, token).catch(() => null),
    freeVisitSlots(nowMs).catch(() => [] as string[]),
  ]);
  return { nowMs, siteSettings, visit, free };
}

/** The visitor's own page, from the link in their emails: change the time, cancel, or book again. */
export default async function ManageVisitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const id = one(params.v).slice(0, 40);
  const token = one(params.t).slice(0, 40);
  const { nowMs, siteSettings, visit, free } = await load(id, token);
  const whatsappHref = whatsappUrl(siteSettings.contactPhone, "Hi, it's about my site visit to The Lexington.");

  return (
    <>
      <PageIntro eyebrow="Visit" title="Your site visit." lede="Change the time, cancel, or book another visit." />
      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <div className={styles.grid}>
            {visit ? (
              <ManageVisit
                initial={visit}
                id={id}
                token={token}
                free={free}
                nowMs={nowMs}
                address={siteSettings.officeAddress}
                mapUrl={googleMapsUrl()}
                whatsappHref={whatsappHref}
              />
            ) : (
              <div className={styles.panel}>
                <div className="eyebrow">Link not recognised</div>
                <p style={{ marginTop: 12 }}>
                  We couldn&rsquo;t find a visit for this link. Please use the link in your email, <Link href="/visit">book a new visit</Link>, or{" "}
                  <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                    message us on WhatsApp
                  </a>
                  .
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
