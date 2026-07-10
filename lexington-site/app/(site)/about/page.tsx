import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { familyMembersQuery, galleryImagesQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { FamilyMember, GalleryImage, SiteSettings } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { LegacyTimeline } from "@/components/LegacyTimeline";
import { SplitSection } from "@/components/SplitSection";
import { PhotoTriptych } from "@/components/PhotoTriptych";
import { Button } from "@/components/Button";

export const revalidate = 60;

export const metadata = {
  title: "Our Story | The Lexington — Skarlatos & Son",
};

export default async function AboutPage() {
  const [members, images, siteSettings] = await Promise.all([
    client.fetch<FamilyMember[]>(familyMembersQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
  ]);

  const exteriorImages = images.filter((i) => i.category === "exterior");
  const exteriorImage = exteriorImages.find((i) => i.order > 0);
  const triptychImages = exteriorImages.slice(2, 5);

  return (
    <>
      <PageIntro {...siteSettings.aboutIntro} />

      <section className="section sectionStone" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
        <div className="wrap">
          <LegacyTimeline members={members} />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <PhotoTriptych
            images={triptychImages}
            caption="The Lexington, Shiashie — the latest work carrying the family name."
          />
        </div>
      </section>

      {exteriorImage && (
        <SplitSection
          imageUrl={urlFor(exteriorImage.image).width(800).height(1000).url()}
          imageAlt={exteriorImage.alt}
          reverse
          eyebrow="The Lexington"
          title="Building on that foundation."
        >
          <p>
            The Lexington is the latest chapter in a family history written
            across Tema&rsquo;s master plan, MTN&rsquo;s headquarters, and a
            resort in the Carpathians. It carries the same standard forward —
            into eight storeys in Shiashie, East Legon.
          </p>
          <Button href="/residences" variant="outline-dark">
            View Residences
          </Button>
        </SplitSection>
      )}

      <section className="section sectionAlt" style={{ textAlign: "center" }}>
        <div className="wrap">
          <div className="eyebrow" style={{ justifyContent: "center", display: "flex" }}>
            Get in Touch
          </div>
          <h2 style={{ marginTop: 14, fontSize: "var(--fs-600)" }}>
            Speak with the family directly.
          </h2>
          <div style={{ marginTop: 32, display: "flex", justifyContent: "center" }}>
            <Button href="/contact" variant="clay">
              Contact Us
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
