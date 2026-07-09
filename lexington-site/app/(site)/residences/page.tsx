import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import {
  galleryImagesQuery,
  siteSettingsQuery,
  unitLocationPlansQuery,
  unitsQuery,
} from "@/lib/sanity/queries";
import type { BedroomType, GalleryImage, SiteSettings, Unit, UnitLocationPlan } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { UnitFinder } from "@/components/UnitFinder";
import { SplitSection } from "@/components/SplitSection";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Reveal } from "@/components/Reveal";

export const revalidate = 60;

export const metadata = {
  title: "Residences & Floor Plans | The Lexington",
};

const extras = [
  { key: "parking-lift", label: "Parking", title: "Covered parking near lifts — $5,000/space, purchased in pairs" },
  { key: "parking-compound", label: "Parking", title: "Compound parking included — 1 space for 1BR, 2 for 2BR+" },
  { key: "storage-bq", label: "Storage", title: "Boys' quarters — $1,250/sqm (8–12 sqm units)" },
  { key: "storage-unit", label: "Storage", title: "Storage units — $1,200/sqm (4–12 sqm units)" },
];

export default async function ResidencesPage() {
  const [units, images, siteSettings, unitLocationPlans] = await Promise.all([
    client.fetch<Unit[]>(unitsQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
    client.fetch<UnitLocationPlan[]>(unitLocationPlansQuery),
  ]);

  const floorplanImages = images.filter((i) => i.category === "floorplan");
  const floorplanImage = floorplanImages[0];

  // Duplex penthouses span two levels, so they have two floor plans (lower
  // + upper/rooftop) that both need to be viewable — everything else has one.
  const floorPlansByType: Record<BedroomType, GalleryImage[]> = {
    "One Bedroom": floorplanImages.filter((i) => i.alt.toLowerCase().includes("one-bedroom")),
    "Two Bedroom": floorplanImages.filter((i) => i.alt.toLowerCase().includes("two-bedroom")),
    "3BR Duplex Penthouse": floorplanImages.filter((i) => i.alt.toLowerCase().includes("duplex")),
  };

  // A floor's units are sometimes split across two location diagrams (not
  // every unit fits in one render), so look up by unit number rather than
  // by floor alone.
  const locationPlanByUnit: Record<string, UnitLocationPlan> = {};
  for (const plan of unitLocationPlans) {
    for (const unitNumber of plan.units) {
      locationPlanByUnit[unitNumber] = plan;
    }
  }

  return (
    <>
      <PageIntro {...siteSettings.residencesIntro} />

      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <UnitFinder units={units} floorPlans={floorPlansByType} locationPlanByUnit={locationPlanByUnit} />
        </div>
      </section>

      {floorplanImage && (
        <SplitSection
          imageUrl={urlFor(floorplanImage.image).width(800).height(1000).url()}
          imageAlt={floorplanImage.alt}
          eyebrow="Floor Plans"
          title="Drawn for how you actually live."
          style={{ background: "var(--stone-lt)" }}
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
          <p className="disclaimer" style={{ marginTop: 32 }}>
            All extras are alternatively available on monthly rental.
          </p>
        </div>
      </section>
    </>
  );
}
