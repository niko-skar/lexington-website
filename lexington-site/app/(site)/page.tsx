import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import {
  amenitiesQuery,
  familyMembersQuery,
  financingPlanQuery,
  galleryImagesQuery,
  siteSettingsQuery,
  unitsQuery,
} from "@/lib/sanity/queries";
import type {
  Amenity,
  FamilyMember,
  FinancingPlan,
  GalleryImage,
  SiteSettings,
  Unit,
} from "@/lib/sanity/types";
import { formatUSD } from "@/lib/format";

import { Hero } from "@/components/Hero";
import { Button } from "@/components/Button";
import { ProximityGrid } from "@/components/ProximityGrid";
import { SplitSection } from "@/components/SplitSection";
import { StatStrip } from "@/components/StatStrip";
import { Reveal } from "@/components/Reveal";
import { InteractiveMap } from "@/components/InteractiveMap";

export const revalidate = 60;

export default async function HomePage() {
  const [units, images, amenities, financingPlan, siteSettings, familyMembers] = await Promise.all([
    client.fetch<Unit[]>(unitsQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<Amenity[]>(amenitiesQuery),
    client.fetch<FinancingPlan>(financingPlanQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
    client.fetch<FamilyMember[]>(familyMembersQuery),
  ]);

  const availableUnits = units.filter((u) => u.status === "available");
  const startingPrice = Math.min(...availableUnits.map((u) => u.priceUSD));

  const exteriorImages = images.filter((i) => i.category === "exterior");
  const interiorImages = images.filter((i) => i.category === "interior");

  const heroImage = exteriorImages[0];
  const residencesImage = interiorImages[1] ?? interiorImages[0];
  // Niko is the generation actively developing The Lexington — his photo
  // is the most relevant single portrait for this teaser.
  const familyPhotoMember =
    familyMembers.find((m) => m.name.includes("Niko")) ?? familyMembers[0];

  const featuredAmenities = amenities
    .filter((a) => a.category === "signature" || a.category === "rooftop")
    .sort((a, b) => a.order - b.order);

  const reservationAmount =
    financingPlan?.selfFinanceRows?.[0]?.option1 ?? "$10,000";
  const projectedYield = financingPlan?.buyToRent?.projectedYieldPct ?? 11;

  return (
    <>
      <Hero
        imageUrl={urlFor(heroImage.image).width(1920).height(1280).url()}
        imageAlt={heroImage.alt}
        eyebrow={siteSettings.heroEyebrow}
      >
        <h1>{siteSettings.heroTitle}</h1>
        <p className="lede">{siteSettings.heroLede}</p>
        <div className="actions">
          <Button href="/residences" variant="clay">
            View Residences
          </Button>
          <Button href="/contact" variant="outline-light">
            Reserve a Unit
          </Button>
        </div>
      </Hero>

      <section className="section sectionStone" style={{ background: "var(--stone)", paddingTop: "clamp(48px, 6vw, 80px)" }}>
        <div className="wrap">
          <Reveal>
            <StatStrip
              stats={[
                { value: availableUnits.length, suffix: ` of ${units.length}`, label: "Units available" },
                { value: startingPrice, prefix: "$", label: "Starting from" },
                { value: projectedYield, suffix: "%", label: "Projected rental yield" },
                { value: 8, label: "Storeys, Shiashie skyline" },
                { value: 2027, prefix: "Dec ", label: "Estimated completion", noGrouping: true },
              ]}
            />
          </Reveal>
        </div>
      </section>

      <SplitSection
        imageUrl={urlFor(residencesImage.image).width(800).height(1000).url()}
        imageAlt={residencesImage.alt}
        eyebrow="Residences"
        title="One, two and three-bedroom duplex penthouses."
        style={{ paddingTop: "clamp(48px, 6vw, 80px)" }}
      >
        <p>
          Every floor plan is drawn to let daily life move naturally — from
          high-speed elevators and natural stone flooring to a back-up
          generator and water supply that never leave you waiting. Prices
          from {formatUSD(startingPrice)}.
        </p>
        <Button href="/residences" variant="outline-dark">
          Explore Floor Plans
        </Button>
      </SplitSection>

      <section className="section sectionStone" style={{ background: "var(--stone)" }}>
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Location</div>
            <h2 style={{ fontSize: "var(--fs-600)", marginTop: 14 }}>
              Everything, close at hand.
            </h2>
            <p style={{ marginTop: 16, color: "#555", maxWidth: 640 }}>
              Shiashie sits at the quiet centre of East Legon — near enough to
              the city&rsquo;s schools, malls and airport to make the daily
              commute disappear.
            </p>
          </Reveal>
          <div style={{ marginTop: 56 }}>
            <ProximityGrid />
          </div>
          <div style={{ marginTop: "var(--space-8)" }}>
            <InteractiveMap />
          </div>
        </div>
      </section>

      <section className="section sectionAlt">
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Amenities</div>
            <h2 style={{ fontSize: "var(--fs-600)", marginTop: 14 }}>
              World-class amenities, every day.
            </h2>
            <p style={{ marginTop: 16, color: "#555", maxWidth: 560 }}>
              A private rooftop garden, a full lap pool, gym, sauna and more —
              built for a full day, not a quick visit.
            </p>
          </Reveal>
          <Reveal delay={100}>
            <ul
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "28px 32px",
                marginTop: 40,
              }}
            >
              {featuredAmenities.map((a) => (
                <li
                  key={a._id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    fontFamily: "var(--font-serif)",
                    fontSize: 19,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--brass)",
                      flex: "none",
                      display: "inline-block",
                    }}
                  />
                  {a.name}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 44 }}>
              <Button href="/amenities" variant="outline-dark">
                See All Amenities
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      {familyPhotoMember?.photo && (
        <SplitSection
          imageUrl={urlFor(familyPhotoMember.photo).width(800).height(1000).url()}
          imageAlt={familyPhotoMember.name}
          reverse
          eyebrow="Skarlatos & Son"
          title="Three generations shaping Ghana's landscape."
        >
          <p>
            From city-wide planning in 1960s Tema to a six-bedroom residence
            in Shiashie, the family behind The Lexington has been building in
            Ghana since before most of Accra existed as it does today.
          </p>
          <Button href="/about" variant="outline-dark">
            Read Our Story
          </Button>
        </SplitSection>
      )}

      <section className="section sectionAlt" style={{ textAlign: "center" }}>
        <div className="wrap">
          <Reveal>
            <div className="eyebrow" style={{ justifyContent: "center", display: "flex" }}>
              Reserve
            </div>
            <h2 style={{ fontSize: "var(--fs-600)", marginTop: 14 }}>
              Secure your residence with a {reservationAmount} deposit.
            </h2>
            <p style={{ maxWidth: 560, margin: "18px auto 0", color: "#555", fontSize: 16.5 }}>
              Flexible self-finance and mortgage payment plans are available,
              with early-payment discounts of up to 12.5%.
            </p>
            <div style={{ marginTop: 32 }}>
              <Button href="/contact" variant="clay">
                Start Your Reservation
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
