import Link from "next/link";

import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { googleMapsUrl, LEXINGTON_COORDS } from "@/lib/maps";
import { phoneHref, whatsappUrl } from "@/lib/format";
import styles from "./SiteFooter.module.css";

// Muted, desaturated theme so the map thumbnail sits quietly in the dark
// footer instead of clashing with Google's default bright red/green style.
const MAP_STYLE = [
  "feature:all|element:geometry|saturation:-65|lightness:-8",
  "feature:water|element:geometry|color:0x263a48",
  "feature:all|element:labels|visibility:off",
  "feature:road|element:geometry|saturation:-70|lightness:15",
  "feature:poi|visibility:off",
].map((rule) => `style=${encodeURIComponent(rule)}`);

function footerMapUrl() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const { lat, lng } = LEXINGTON_COORDS;
  const params = [
    `center=${lat},${lng}`,
    "zoom=13",
    "size=280x160",
    "scale=2",
    `markers=color:0xb08d57%7C${lat},${lng}`,
    ...MAP_STYLE,
    `key=${apiKey}`,
  ];
  return `https://maps.googleapis.com/maps/api/staticmap?${params.join("&")}`;
}

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
            <a
              className={styles.mapThumb}
              href={googleMapsUrl()}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View The Lexington's location on Google Maps"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={footerMapUrl()} alt="Map showing The Lexington's location in Shiashie, East Legon" width={280} height={160} />
            </a>
          </div>
          <div className={styles.links}>
            <div>
              <h4>Explore</h4>
              <Link href="/residences">Residences</Link>
              <Link href="/amenities">Amenities</Link>
              <Link href="/gallery">Gallery</Link>
              <Link href="/progress">Progress</Link>
              <Link href="/invest">Invest</Link>
            </div>
            <div>
              <h4>Contact</h4>
              <a href={phoneHref(siteSettings.contactPhone)}>{siteSettings.contactPhone}</a>
              <a
                href={whatsappUrl(siteSettings.contactPhone, "Hi, I'm interested in The Lexington.")}
                target="_blank"
                rel="noopener noreferrer"
              >
                Message on WhatsApp
              </a>
              <a href={`mailto:${siteSettings.contactEmail}`}>{siteSettings.contactEmail}</a>
              <Link href="/contact">Reserve a Unit</Link>
            </div>
          </div>
        </div>
        <div className={styles.bottom}>
          <span>© {new Date().getFullYear()} Skarlatos &amp; Son. All rights reserved.</span>
          <a href={googleMapsUrl()} target="_blank" rel="noopener noreferrer">
            {siteSettings.officeAddress}
          </a>
        </div>
      </div>
    </footer>
  );
}
