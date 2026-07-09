import Link from "next/link";

import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { googleMapsUrl } from "@/lib/maps";
import { phoneHref } from "@/lib/format";
import styles from "./SiteFooter.module.css";

export async function SiteFooter() {
  const siteSettings = await client.fetch<SiteSettings>(siteSettingsQuery);

  return (
    <footer className={styles.footer}>
      <div className="wrap">
        <div className={styles.top}>
          <div>
            <div className={styles.brand}>
              The Lexington
              <small>A Skarlatos &amp; Son Development</small>
            </div>
          </div>
          <div className={styles.links}>
            <div>
              <h4>Explore</h4>
              <Link href="/residences">Residences</Link>
              <Link href="/amenities">Amenities</Link>
              <Link href="/gallery">Gallery</Link>
              <Link href="/invest">Invest</Link>
            </div>
            <div>
              <h4>Contact</h4>
              <a href={phoneHref(siteSettings.contactPhone)}>{siteSettings.contactPhone}</a>
              <a href={`mailto:${siteSettings.contactEmail}`}>{siteSettings.contactEmail}</a>
              <Link href="/contact">Reserve a Unit</Link>
            </div>
          </div>
        </div>
        <div className={styles.bottom}>
          <span>© {new Date().getFullYear()} Skarlatos &amp; Son. All rights reserved.</span>
          <a href={googleMapsUrl(siteSettings.officeAddress)} target="_blank" rel="noopener noreferrer">
            {siteSettings.officeAddress}
          </a>
        </div>
      </div>
    </footer>
  );
}
