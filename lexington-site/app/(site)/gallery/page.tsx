import { client } from "@/lib/sanity/client";
import { galleryImagesQuery } from "@/lib/sanity/queries";
import type { GalleryImage } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { Gallery } from "@/components/Gallery";
import { Button } from "@/components/Button";

export const revalidate = 60;

export const metadata = {
  title: "Gallery | The Lexington",
};

export default async function GalleryPage() {
  const images = await client.fetch<GalleryImage[]>(galleryImagesQuery);

  return (
    <>
      <PageIntro
        eyebrow="Gallery"
        title="A closer look."
        lede="All images are illustrative renders and may not reflect the final product."
      />

      <section style={{ paddingTop: 0 }}>
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
