import Image from "next/image";

import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { amenitiesQuery, galleryImagesQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { Amenity, GalleryImage, SiteSettings } from "@/lib/sanity/types";

import { FeatureGrid } from "@/components/FeatureGrid";
import { Reveal } from "@/components/Reveal";
import { Amenities3DStage } from "@/components/Amenities3D";
import { AMENITY_SPOTS, SPOT_OF_AMENITY } from "@/lib/amenities3d";
import styles from "@/components/Amenities3D.module.css";

export const revalidate = 600;

export const metadata = pageMetadata({
  path: "/amenities",
  title: "Amenities & Specifications | The Lexington",
  description:
    "Swimming pool, gym, sauna, rooftop garden and café, plus backup power, CCTV and high-speed lifts. The full specification for The Lexington, East Legon.",
});

// (25 Nov 2026, Niko: "focus primarily on this model only") The page is built round the amenity floor in 3D: the page's title
// and the live model share the opening band; below it, small, the rooftop garden (it is on the roof, not in the model) and the
// building features. The amenity cards and the photo sections it had before are gone: each amenity's photo and line are in its
// card on the model now (the photos are still in the Gallery).
export default async function AmenitiesPage() {
  const [amenities, images, siteSettings] = await Promise.all([
    client.fetch<Amenity[]>(amenitiesQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
  ]);

  const signature = amenities.filter((a) => a.category === "signature").sort((a, b) => a.order - b.order);
  const rooftop = amenities.filter((a) => a.category === "rooftop").sort((a, b) => a.order - b.order);
  const buildingFeatures = amenities
    .filter((a) => a.category === "building feature")
    .sort((a, b) => a.order - b.order)
    .map((a) => ({ key: a._id, label: "Building", title: a.name }));

  // each amenity's own photo and line, for its card on the model
  const photos: Record<string, string> = {};
  const captions: Record<string, string> = {};
  for (const a of signature) {
    const spot = SPOT_OF_AMENITY[a._id];
    if (!spot) continue;
    if (a.image) photos[spot] = urlFor(a.image).width(960).height(540).url();
    if (a.caption) captions[spot] = a.caption;
  }

  const amenityImages = images.filter((i) => i.category === "amenity");
  const findImage = (needle: string) => amenityImages.find((i) => i.alt.toLowerCase().includes(needle));
  const gardenImage = findImage("rooftop terrace") ?? findImage("rooftop");
  const intro = siteSettings.amenitiesIntro;

  return (
    <>
      <section className={`sectionDark ${styles.hero}`}>
        <div className="wrap">
          <Reveal>
            <div className={styles.head}>
              <div>
                <div className="eyebrow">{intro.eyebrow}</div>
                <h1 className={styles.title}>{intro.title}</h1>
              </div>
              {intro.lede && <p className={styles.lede}>{intro.lede}</p>}
            </div>
          </Reveal>
          <Amenities3DStage photos={photos} captions={captions} />
          {/* the amenities as text too, for search engines and screen readers (people use the model's own list) */}
          <ul className={styles.srOnly}>
            {AMENITY_SPOTS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.name}</a>
                {captions[s.id] ? `: ${captions[s.id]}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {rooftop.length > 0 && gardenImage && (
        <section className="section">
          <div className={`wrap ${styles.roof}`}>
            <Reveal className={styles.roofMedia}>
              <Image
                src={urlFor(gardenImage.image).width(1120).height(700).url()}
                alt={gardenImage.alt}
                width={1120}
                height={700}
                sizes="(max-width: 880px) 100vw, 50vw"
              />
            </Reveal>
            <Reveal delay={120}>
              <div className="eyebrow">Rooftop</div>
              <h2 className={styles.roofTitle}>A private garden, above it all.</h2>
              <p className={styles.roofText}>
                The Private Resident&rsquo;s Rooftop Garden sits at the very top of the building — a quiet, planted space
                reserved for residents.
              </p>
            </Reveal>
          </div>
        </section>
      )}

      <section className="section sectionAlt">
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Building Features</div>
            <h2 style={{ fontSize: "var(--fs-600)", marginTop: 14, marginBottom: 40 }}>Built into every floor.</h2>
          </Reveal>
          <FeatureGrid items={buildingFeatures} />
        </div>
      </section>
    </>
  );
}
