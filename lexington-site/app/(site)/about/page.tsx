import Image from "next/image";
import Link from "next/link";

import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { familyMembersQuery, galleryImagesQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { FamilyMember, GalleryImage, SiteSettings } from "@/lib/sanity/types";
import { FAMILY, GENERATION_PLATES, OLYMPIAN_URL, RECORD, ordinalOf, romanOf } from "@/lib/olympian";

import { PageIntro } from "@/components/PageIntro";
import { SplitSection } from "@/components/SplitSection";
import { StatStrip } from "@/components/StatStrip";
import { Button } from "@/components/Button";
import { Reveal } from "@/components/Reveal";

import styles from "./about.module.css";

export const revalidate = 600;

export const metadata = pageMetadata({
  path: "/about",
  title: "Our Story | The Lexington — An Olympian Development",
  description:
    "Three generations of the Skarlatos family shaping Ghana's landscape, and the thinking behind The Lexington in Shiashie, East Legon.",
});

/**
 * Our Story in The Lexington's own look (Niko, 25 Nov 2026: "our story page also needs to be in the lexington brand and
 * format, right now it's just lifted from olympian developments website"): the site's intro band, its serif headings and
 * brass labels, the figures strip of the home page, cards and a split section. The facts are the same record as before
 * (lib/olympian.ts and Sanity's family entries). PRIVACY RULE: the family name only — no first names, no photographs of
 * family members; the generations are told apart by number.
 */
export default async function AboutPage() {
  const [members, images, siteSettings] = await Promise.all([
    client.fetch<FamilyMember[]>(familyMembersQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
  ]);

  const exteriorImage = images.filter((i) => i.category === "exterior").find((i) => i.order > 0);

  // Only the years and the bio are read from each entry — never the name or the photo.
  const generations = members.map((m, i) => ({
    key: m._id,
    numeral: romanOf(i),
    ordinal: ordinalOf(i),
    years: m.years,
    bio: m.bio,
    ...(GENERATION_PLATES[i] ?? { tags: [], places: [] }),
  }));

  return (
    <>
      <PageIntro
        eyebrow={siteSettings.aboutIntro.eyebrow}
        title={siteSettings.aboutIntro.title}
        lede={siteSettings.aboutIntro.lede || `The ${FAMILY} family, building in Ghana since the 1960s.`}
      />

      {/* The family company, and the figures */}
      <section className="section sectionStone" style={{ paddingTop: "clamp(48px, 6vw, 88px)" }}>
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Olympian Developments</div>
            <h2 className={styles.title}>A family company, building in Ghana since the 1960s.</h2>
            <p className={styles.lede}>
              <a href={OLYMPIAN_URL} target="_blank" rel="noopener" className="devLink">
                Olympian Developments
              </a>{" "}
              is the {FAMILY} family&rsquo;s development company. The family&rsquo;s work in Ghana runs back to the 1960s, from
              the planning of a city to eight storeys rising in East Legon.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <div className={styles.figures}>
              <StatStrip
                stats={[
                  { value: 3, label: `Generations of the ${FAMILY} family` },
                  { value: 1960, suffix: "s", label: "Building in Ghana since", noGrouping: true },
                  { value: 4, label: "Countries: Ghana, the UK, Côte d'Ivoire, Romania" },
                  { value: 8, label: "Storeys rising on Duala Close" },
                ]}
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Three generations */}
      <section className="section sectionAlt">
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">Three generations</div>
            <h2 className={styles.title}>Each generation, its own work.</h2>
            <p className={styles.lede}>The earlier projects are credited to the generation that led them.</p>
          </Reveal>
          <ol className={styles.generations}>
            {generations.map((g, i) => (
              <li key={g.key}>
                <Reveal delay={i * 100} className={styles.generation}>
                  <div className={`${styles.picture} ${g.plate?.kind === "drawing" ? styles.drawing : ""}`}>
                    {g.plate ? (
                      <Image src={g.plate.src} alt={g.plate.alt} width={g.plate.w} height={g.plate.h} sizes="(max-width: 880px) 92vw, 30vw" />
                    ) : (
                      <span className={styles.numeral} aria-hidden="true">
                        {g.numeral}
                      </span>
                    )}
                  </div>
                  <div className={styles.genText}>
                    <div className={styles.kicker}>{FAMILY}</div>
                    <h3 className={styles.genTitle}>{g.ordinal} generation</h3>
                    <div className={styles.years}>{g.years}</div>
                    <p className={styles.bio}>{g.bio}</p>
                    {g.tags.length > 0 && (
                      <ul className={styles.tags}>
                        {g.tags.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* The record */}
      <section className="section sectionStone">
        <div className="wrap">
          <Reveal>
            <div className="eyebrow">The record</div>
            <h2 className={styles.title}>Six decades, four countries.</h2>
          </Reveal>
          <ul className={styles.record}>
            {RECORD.map((p, i) => (
              <li key={p.name}>
                <Reveal delay={(i % 2) * 80} className={styles.project}>
                  <div className={styles.projectTop}>
                    <span className={styles.place}>{p.location}</span>
                    <span className={p.current ? styles.now : styles.period}>{p.period}</span>
                  </div>
                  <h3 className={styles.projectName}>{p.name}</h3>
                  <p className={styles.projectText}>{p.summary}</p>
                  <div className={styles.projectFoot}>
                    <span>Led by the {ordinalOf(p.ledBy).toLowerCase()} generation</span>
                    {p.link && (
                      <Link href={p.link.href} className={styles.projectLink}>
                        {p.link.label}
                      </Link>
                    )}
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
          <a href={`${OLYMPIAN_URL}/work`} target="_blank" rel="noopener" className={styles.outLink}>
            See all the work at olympiandevelopments.com
          </a>
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
            The Lexington is the latest chapter in a family history written across Tema&rsquo;s master plan, MTN&rsquo;s
            headquarters, and a resort in the Carpathians. It carries the same standard forward — into eight storeys in
            Shiashie, East Legon.
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
          <h2 style={{ marginTop: 14, fontSize: "var(--fs-600)" }}>Speak with the family directly.</h2>
          <div style={{ marginTop: 32, display: "flex", justifyContent: "center" }}>
            <Button href="/contact" variant="clay">
              Contact Us
            </Button>
          </div>
          <a href={OLYMPIAN_URL} target="_blank" rel="noopener" className={styles.olympianLink}>
            Olympian Developments · olympiandevelopments.com
          </a>
        </div>
      </section>
    </>
  );
}
