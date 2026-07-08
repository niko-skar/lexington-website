import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { amenitiesQuery, galleryImagesQuery } from "@/lib/sanity/queries";
import type { Amenity, GalleryImage } from "@/lib/sanity/types";

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
  const [amenities, images] = await Promise.all([
    client.fetch<Amenity[]>(amenitiesQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
  ]);

  const rooftop = amenities
    .filter((a) => a.category === "rooftop")
    .sort((a, b) => a.order - b.order);
  const buildingFeatures = amenities
    .filter((a) => a.category === "building feature")
    .sort((a, b) => a.order - b.order)
    .map((a) => ({ key: a._id, label: "Building", title: a.name }));

  const amenityImages = images.filter((i) => i.category === "amenity");
  const heroImage = amenityImages[0];
  const poolImage = amenityImages[1] ?? amenityImages[0];
  const loungeImage = amenityImages[2] ?? amenityImages[0];

  return (
    <>
      <PageIntro
        eyebrow="Amenities"
        title="A rooftop built for a full day."
        lede="Every resident's amenity sits seven storeys above Shiashie, with the building features to match below."
      />

      {heroImage && (
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="wrap">
            <Reveal>
              <AmenityCardGrid amenities={rooftop} />
            </Reveal>
          </div>
        </section>
      )}

      {poolImage && (
        <SplitSection
          imageUrl={urlFor(poolImage.image).width(800).height(1000).url()}
          imageAlt={poolImage.alt}
          eyebrow="Rooftop"
          title="Pool, gym and everything after."
        >
          <p>
            The rooftop level is built as a genuine amenity floor, not an
            afterthought — a full lap pool, a fitted gym, sauna, jacuzzi and
            ice bath, all with skyline views over Shiashie.
          </p>
        </SplitSection>
      )}

      {loungeImage && (
        <SplitSection
          imageUrl={urlFor(loungeImage.image).width(800).height(1000).url()}
          imageAlt={loungeImage.alt}
          reverse
          eyebrow="Café & Lounge"
          title="A rooftop café for residents."
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
