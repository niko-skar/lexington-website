import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { amenitiesQuery, galleryImagesQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { Amenity, GalleryImage, SiteSettings } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { AmenityCardGrid } from "@/components/AmenityCard";
import { FeatureGrid } from "@/components/FeatureGrid";
import { SplitSection } from "@/components/SplitSection";
import { Reveal } from "@/components/Reveal";

export const revalidate = 60;

export const metadata = {
  title: "Amenities & Specifications | The Lexington",
};

export default async function AmenitiesPage() {
  const [amenities, images, siteSettings] = await Promise.all([
    client.fetch<Amenity[]>(amenitiesQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
  ]);

  const signature = amenities
    .filter((a) => a.category === "signature")
    .sort((a, b) => a.order - b.order);
  const rooftop = amenities
    .filter((a) => a.category === "rooftop")
    .sort((a, b) => a.order - b.order);
  const buildingFeatures = amenities
    .filter((a) => a.category === "building feature")
    .sort((a, b) => a.order - b.order)
    .map((a) => ({ key: a._id, label: "Building", title: a.name }));

  const amenityImages = images.filter((i) => i.category === "amenity");
  const findImage = (needle: string) =>
    amenityImages.find((i) => i.alt.toLowerCase().includes(needle));

  const poolImage = findImage("pool") ?? amenityImages[0];
  const gardenImage = findImage("rooftop terrace") ?? findImage("rooftop") ?? amenityImages[0];
  const loungeImage = findImage("café") ?? amenityImages[0];

  return (
    <>
      <PageIntro {...siteSettings.amenitiesIntro} />

      {signature.length > 0 && (
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <div className="eyebrow">Signature Amenities</div>
            </Reveal>
            <div style={{ marginTop: 24 }}>
              <AmenityCardGrid amenities={signature} images={amenityImages} />
            </div>
          </div>
        </section>
      )}

      {poolImage && (
        <SplitSection
          imageUrl={urlFor(poolImage.image).width(800).height(1000).url()}
          imageAlt={poolImage.alt}
          eyebrow="Signature"
          title="Pool, gym, and everything after."
        >
          <p>
            A full lap pool, a fitted gym, sauna, jacuzzi and ice bath —
            everything residents need for a full day, without leaving the
            building.
          </p>
        </SplitSection>
      )}

      {rooftop.length > 0 && gardenImage && (
        <SplitSection
          imageUrl={urlFor(gardenImage.image).width(800).height(1000).url()}
          imageAlt={gardenImage.alt}
          reverse
          eyebrow="Rooftop"
          title="A private garden, above it all."
        >
          <p>
            The Private Resident&rsquo;s Rooftop Garden sits at the very top
            of the building — a quiet, planted space reserved for residents.
          </p>
        </SplitSection>
      )}

      {loungeImage && (
        <SplitSection
          imageUrl={urlFor(loungeImage.image).width(800).height(1000).url()}
          eyebrow="Café & Lounge"
          title="A café built for residents."
          imageAlt={loungeImage.alt}
        >
          <p>
            A private café and lounge area for residents and guests, built for
            evenings as much as mornings.
          </p>
        </SplitSection>
      )}

      <section className="section sectionAlt">
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Building Features</div>
            <h2 style={{ fontSize: "var(--fs-600)", marginTop: 14, marginBottom: 40 }}>
              Built into every floor.
            </h2>
          </Reveal>
          <FeatureGrid items={buildingFeatures} />
        </div>
      </section>
    </>
  );
}
