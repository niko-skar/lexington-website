import { client } from "@/lib/sanity/client";
import { constructionUpdatesQuery, galleryImagesQuery, latestProgressReportQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { ConstructionUpdate, GalleryImage, ProgressReport, SiteSettings } from "@/lib/sanity/types";

import { Button } from "./Button";
import { Gallery } from "./Gallery";
import { PageIntro } from "./PageIntro";

/** What the renders are, said where the page's own intro (Progress's) doesn't say it. */
const RENDERS_NOTE = "Exterior, interior and amenity images are illustrative renders and may not reflect the final product.";

/**
 * The Gallery, with the construction progress inside it (Niko, 25 Nov 2026: progress into the gallery, so the menu is
 * shorter). Two addresses show it: /gallery opens on All with the Gallery's intro; /progress, whose links are on
 * Facebook, Instagram, the site app and in the replies, opens on Progress with the Progress intro.
 */
export async function GalleryPage({ entry }: { entry: "gallery" | "progress" }) {
  const [images, updates, latest, siteSettings] = await Promise.all([
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<ConstructionUpdate[]>(constructionUpdatesQuery),
    client.fetch<ProgressReport | null>(latestProgressReportQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
  ]);

  return (
    <>
      <PageIntro {...(entry === "progress" ? siteSettings.progressIntro : siteSettings.galleryIntro)} />

      <section style={{ paddingTop: "clamp(24px, 3vw, 40px)" }}>
        <div className="wrap">
          <Gallery
            images={images}
            updates={updates}
            latest={latest}
            initial={entry === "progress" ? "progress" : "all"}
            progressNote={entry === "progress" ? null : (siteSettings.progressIntro?.lede ?? null)}
            rendersNote={entry === "progress" ? RENDERS_NOTE : null}
          />
        </div>
      </section>

      <section className="section sectionAlt" style={{ textAlign: "center" }}>
        <div className="wrap">
          <div className="eyebrow" style={{ justifyContent: "center", display: "flex" }}>
            Next Step
          </div>
          <h2 style={{ marginTop: 14, fontSize: "var(--fs-600)" }}>See pricing by floor.</h2>
          <div style={{ marginTop: 32, display: "flex", justifyContent: "center" }}>
            <Button href="/residences" variant="clay">
              View Residences
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
