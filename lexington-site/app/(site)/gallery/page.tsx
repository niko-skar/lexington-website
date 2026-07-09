import { client } from "@/lib/sanity/client";
import { galleryImagesQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { GalleryImage, SiteSettings } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { Gallery } from "@/components/Gallery";
import { Button } from "@/components/Button";

export const revalidate = 60;

export const metadata = {
  title: "Gallery | The Lexington",
};

export default async function GalleryPage() {
  const [images, siteSettings] = await Promise.all([
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
  ]);

  return (
    <>
      <PageIntro {...siteSettings.galleryIntro} />

      <section style={{ paddingTop: "clamp(24px, 3vw, 40px)" }}>
        <div className="wrap">
          <Gallery images={images} />
        </div>
      </section>

      <section className="section sectionAlt" style={{ textAlign: "center" }}>
        <div className="wrap">
          <div className="eyebrow" style={{ justifyContent: "center", display: "flex" }}>
            Next Step
          </div>
          <h2 style={{ marginTop: 14, fontSize: "var(--fs-600)" }}>
            See pricing by floor.
          </h2>
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
