import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { familyMembersQuery, galleryImagesQuery } from "@/lib/sanity/queries";
import type { FamilyMember, GalleryImage } from "@/lib/sanity/types";

import { PageIntro } from "@/components/PageIntro";
import { LegacyTimeline } from "@/components/LegacyTimeline";
import { SplitSection } from "@/components/SplitSection";
import { Button } from "@/components/Button";

export const revalidate = 60;

export const metadata = {
  title: "Our Story | The Lexington — Skarlatos & Son",
};

export default async function AboutPage() {
  const [members, images] = await Promise.all([
    client.fetch<FamilyMember[]>(familyMembersQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
  ]);

  const exteriorImage = images.find((i) => i.category === "exterior" && i.order > 0);

  return (
    <>
      <PageIntro
        eyebrow="Skarlatos & Son"
        title="Three generations shaping Ghana's landscape."
      />

      <section className="section sectionDark" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <LegacyTimeline members={members} />
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
            into seven storeys in Shiashie, East Legon.
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
