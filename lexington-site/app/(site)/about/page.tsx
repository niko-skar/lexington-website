import Image from "next/image";
import Link from "next/link";
import { JetBrains_Mono } from "next/font/google";

import { pageMetadata } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { urlFor } from "@/lib/sanity/image";
import { familyMembersQuery, galleryImagesQuery, siteSettingsQuery } from "@/lib/sanity/queries";
import type { FamilyMember, GalleryImage, SiteSettings } from "@/lib/sanity/types";
import {
  FAMILY,
  FIGURES,
  GENERATION_PLATES,
  OLYMPIAN_URL,
  PLACES,
  RECORD,
  coordsOf,
  ordinalOf,
  romanOf,
} from "@/lib/olympian";

import { PageIntro } from "@/components/PageIntro";
import { SplitSection } from "@/components/SplitSection";
import { Button } from "@/components/Button";
import { Reveal } from "@/components/Reveal";

import styles from "./about.module.css";

export const revalidate = 600;

// The drawing-set labels of olympiandevelopments.com (sheet numbers, plates,
// coordinates). Loaded on this page only.
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata = pageMetadata({
  path: "/about",
  title: "Our Story | The Lexington — An Olympian Development",
  description:
    "Three generations of the Skarlatos family shaping Ghana's landscape, and the thinking behind The Lexington in Shiashie, East Legon.",
});

/**
 * Our Story, in the manner of olympiandevelopments.com: a statement, the three
 * generations (told apart by number — no first names, no family photos; see
 * lib/olympian.ts), the record of the family's work, then The Lexington.
 */
export default async function AboutPage() {
  const [members, images, siteSettings] = await Promise.all([
    client.fetch<FamilyMember[]>(familyMembersQuery),
    client.fetch<GalleryImage[]>(galleryImagesQuery),
    client.fetch<SiteSettings>(siteSettingsQuery),
  ]);

  const exteriorImage = images.filter((i) => i.category === "exterior").find((i) => i.order > 0);

  // Only years and bio are read from each member — never the name or photo.
  const generations = members.map((m, i) => ({
    key: m._id,
    numeral: romanOf(i),
    ordinal: ordinalOf(i),
    years: m.years,
    born: m.years.match(/\d{4}/)?.[0] ?? "",
    bio: m.bio,
    ...(GENERATION_PLATES[i] ?? { tags: [], places: [] }),
  }));

  return (
    <div className={mono.variable}>
      <PageIntro
        eyebrow={siteSettings.aboutIntro.eyebrow}
        title={siteSettings.aboutIntro.title}
        lede={siteSettings.aboutIntro.lede || `The ${FAMILY} family, building in Ghana since the 1960s.`}
      />

      {/* 01 — Statement */}
      <section className={`section ${styles.statement}`} aria-label="Statement">
        <div className="wrap">
          <Reveal>
            <div className={styles.sheetHead}>
              <span className={styles.sheetNo}>01 — Statement</span>
              <span className={styles.sheetNote}>The family behind The Lexington</span>
            </div>
            <p className={styles.statementText}>
              Olympian Developments is the {FAMILY} family&rsquo;s <em>development company.</em> The family&rsquo;s
              work in Ghana runs back to the <em>1960s</em> — from the planning of a city to eight storeys rising in
              East Legon.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <dl className={styles.figures}>
              {FIGURES.map((f) => (
                <div key={f.label} className={styles.figure}>
                  <dt className={styles.figLabel}>{f.label}</dt>
                  <dd className={styles.figValue}>{f.value}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      {/* 02 — Lineage */}
      <section className={`section sectionAlt ${styles.lineage}`} aria-labelledby="lineage-title">
        <div className="wrap">
          <div className={styles.sheetHead}>
            <span className={styles.sheetNo}>02 — Lineage</span>
            <span className={styles.sheetNote}>Earlier work is credited to the generation that led it</span>
          </div>
          <div className={styles.titleRow}>
            <h2 id="lineage-title" className={styles.bigTitle}>
              Three generations
            </h2>
            <p className={styles.titleLede}>
              The {FAMILY} family, building in Ghana <em>since the 1960s.</em>
            </p>
          </div>

          <ol className={styles.generations}>
            {generations.map((g, i) => (
              <li key={g.key}>
                <Reveal delay={i * 100} className={styles.generation}>
                  <figure className={styles.plateFigure}>
                    <div
                      className={`${styles.plate} ${
                        g.plate ? (g.plate.kind === "drawing" ? styles.plateDrawing : styles.platePhoto) : styles.plateNumeral
                      }`}
                    >
                      <div className={styles.plateTop}>
                        <span>Plate 02.{i + 1}</span>
                        <span>{g.born}</span>
                      </div>
                      <div className={styles.plateBody}>
                        {g.plate ? (
                          <Image
                            src={g.plate.src}
                            alt={g.plate.alt}
                            width={g.plate.w}
                            height={g.plate.h}
                            sizes="(max-width: 880px) 92vw, 30vw"
                          />
                        ) : (
                          <span className={styles.numeral} aria-hidden="true">
                            {g.numeral}
                          </span>
                        )}
                      </div>
                      <ul className={styles.plateFoot}>
                        {g.places.map((p) => (
                          <li key={p}>
                            <span>{PLACES[p].name}</span>
                            <span>{coordsOf(p)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <figcaption className={styles.figCaption}>
                      Fig. 02.{i + 1} — {g.plate ? g.plate.caption : `Generation ${g.numeral}`}
                    </figcaption>
                  </figure>

                  <div className={styles.genText}>
                    <div className={styles.kicker}>
                      {FAMILY} · Generation {g.numeral}
                    </div>
                    <h3 className={styles.genTitle}>
                      <em>{g.ordinal}</em> generation
                    </h3>
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

      {/* 03 — Record */}
      <section className={`section ${styles.record}`} aria-labelledby="record-title">
        <div className="wrap">
          <div className={styles.sheetHead}>
            <span className={styles.sheetNo}>03 — Record</span>
            <span className={styles.sheetNote}>Each project is credited to the generation that led it</span>
          </div>
          <div className={styles.titleRow}>
            <h2 id="record-title" className={styles.bigTitle}>
              The record
            </h2>
            <p className={styles.titleLede}>
              Six decades, <em>four countries.</em>
            </p>
          </div>

          <ol className={styles.recordList}>
            {RECORD.map((p, i) => (
              <li key={p.name} className={styles.recordRow}>
                <span className={styles.recordNo}>{String(i + 1).padStart(2, "0")}</span>
                <div className={styles.recordMain}>
                  <h3 className={styles.recordName}>{p.name}</h3>
                  <div className={styles.recordMeta}>
                    <span>{p.location}</span>
                    <span className={p.current ? styles.live : undefined}>{p.period}</span>
                  </div>
                  <p className={styles.recordSummary}>{p.summary}</p>
                </div>
                <div className={styles.recordSide}>
                  <span>Led by the {ordinalOf(p.ledBy).toLowerCase()} generation</span>
                  <span className={styles.recordCoords}>{coordsOf(p.places[0])}</span>
                  {p.link && (
                    <Link href={p.link.href} className={styles.recordLink}>
                      {p.link.label} →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <a href={`${OLYMPIAN_URL}/work`} target="_blank" rel="noopener" className={styles.outLink}>
            See all the work, in full, at olympiandevelopments.com ↗
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
            The Lexington is the latest chapter in a family history written across Tema&rsquo;s master plan,
            MTN&rsquo;s headquarters, and a resort in the Carpathians. It carries the same standard forward — into
            eight storeys in Shiashie, East Legon.
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
            Olympian Developments · olympiandevelopments.com ↗
          </a>
        </div>
      </section>
    </div>
  );
}
