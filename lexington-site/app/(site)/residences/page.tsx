import { EXTRAS } from "@/lib/extras";
import { vatFrom, vatSuffix } from "@/lib/vat";
import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import {
  galleryImagesQuery,
  packageTiersQuery,
  siteSettingsQuery,
  unitsQuery,
} from "@/lib/sanity/queries";
import type { GalleryImage, PackageTiers, SiteSettings, Unit } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { UnitFinder } from "@/components/UnitFinder";
import { SplitSection } from "@/components/SplitSection";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Reveal } from "@/components/Reveal";
import { VatNote } from "@/components/Vat";

export const revalidate = 600;

// The search snippet names the lowest price, so it says "+ VAT" too once VAT is switched on.
export async function generateMetadata() {
  const settings = await client.fetch<SiteSettings>(siteSettingsQuery);
  return pageMetadata({
    path: "/residences",
    title: "Residences & Floor Plans | The Lexington",
    description: `Studio, one, two and three-bedroom residences and a penthouse duplex in Shiashie, East Legon. Live floor plans, availability and pricing from $72,000${vatSuffix(vatFrom(settings))}.`,
  });
}

const extras = EXTRAS;

export default async function ResidencesPage() {
  const [units, images, siteSettings, packageTiers] = await Promise.all([
    client.fetch<Unit[]>(unitsQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
    client.fetch<PackageTiers | null>(packageTiersQuery),
  ]);

  const tiers = packageTiers?.tiers ?? [];

  const floorplanImages = images.filter((i) => i.category === "floorplan");
  // The rendered penthouse plan (not the flat rooftop diagram) makes for a
  // nicer showcase image than the one-bedroom plan that used to sit here.
  const floorplanImage =
    floorplanImages.find((i) => i.alt.toLowerCase().includes("duplex")) ?? floorplanImages[0];

  return (
    <>
      <PageIntro {...siteSettings.residencesIntro} />

      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <UnitFinder units={units} tiers={tiers} vat={vatFrom(siteSettings)} />
        </div>
      </section>

      {floorplanImage && (
        <SplitSection
          imageUrl={urlFor(floorplanImage.image).width(1000).fit("max").url()}
          imageAlt={floorplanImage.alt}
          eyebrow="Floor Plans"
          title="Drawn for how you actually live."
          style={{ background: "var(--stone-lt)" }}
          fit="contain"
        >
          <p>
            Every unit type is designed around natural light, cross
            ventilation and generous storage — full drawings are available on
            request for any floor or unit.
          </p>
        </SplitSection>
      )}

      <section className="section sectionAlt">
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Available Extras</div>
            <h2 style={{ fontSize: "var(--fs-600)", marginTop: 14, marginBottom: 40 }}>
              Parking, storage and boys&rsquo; quarters.
            </h2>
          </Reveal>
          <FeatureGrid items={extras} />
          <VatNote vat={vatFrom(siteSettings)} />
          <p className="disclaimer" style={{ marginTop: 32 }}>
            All extras are alternatively available on monthly rental.
          </p>
        </div>
      </section>
    </>
  );
}
