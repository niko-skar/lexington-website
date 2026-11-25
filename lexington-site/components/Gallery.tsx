"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";

import type { ConstructionUpdate, GalleryCategory, GalleryImage, ProgressReport } from "@/lib/sanity/types";
import { urlFor } from "@/lib/sanity/image";
import styles from "./Gallery.module.css";
import { LatestUpdate } from "./LatestUpdate";
import { Lightbox } from "./Lightbox";
import { ProgressGallery } from "./ProgressGallery";

/**
 * The renders, in the buttons' order (Niko, 25 Nov 2026: "reorder the gallery photos so it follows the order of the
 * buttons. Exterior first, interior, then amenities and so on"). Floor plans are not shown (Niko, 25 Nov 2026: "in gallery
 * remove all the floor plan photos, it's unnecessary and too many": each home's plans stay in its pop-up on Residences),
 * nor family photos.
 */
const RENDER_KINDS = ["exterior", "interior", "amenity"] as const;
type RenderKind = (typeof RENDER_KINDS)[number];
const isRender = (c: GalleryCategory): c is RenderKind => (RENDER_KINDS as readonly string[]).includes(c);

/** The Gallery's buttons: All, the renders' kinds, then the photos from the site (the Progress page's, 25 Nov 2026). */
export type GalleryTab = "all" | RenderKind | "progress";
const LABEL: Record<Exclude<GalleryTab, "all">, string> = {
  exterior: "Exterior",
  interior: "Interior",
  amenity: "Amenity",
  progress: "Progress",
};

/** Under "All", the newest photos from the site; the Progress button shows every one, by stage. */
const PROGRESS_PREVIEW = 9;

// The first photos on the page are what the page "loads" on, so they are asked
// for straight away; the rest wait until they are scrolled near.
const EAGER_PHOTOS = 3;

interface Photo {
  _id: string;
  image: GalleryImage["image"];
  alt: string;
  kind: RenderKind | "progress";
  order: number;
}

const rank = (k: Photo["kind"]) => (k === "progress" ? RENDER_KINDS.length : RENDER_KINDS.indexOf(k));

/**
 * The Gallery and, since 25 Nov 2026, the construction progress too (Niko: progress into the gallery, to shorten the
 * menu). /gallery opens on All; /progress (its links are on Facebook, Instagram and in the replies) opens on Progress.
 */
export function Gallery({
  images,
  updates,
  latest,
  progressNote = null,
  rendersNote = null,
  initial = "all",
}: {
  images: GalleryImage[];
  /** Every photo from the site (constructionUpdate), any order. */
  updates: ConstructionUpdate[];
  /** The newest site update, at the top of Progress. */
  latest: ProgressReport | null;
  /** A line at the top of Progress when the page's own intro doesn't say it ("Real photos from the site ..."). */
  progressNote?: string | null;
  /** A line over the renders when the page's own intro doesn't say it ("Renders are illustrative ..."). */
  rendersNote?: string | null;
  initial?: GalleryTab;
}) {
  const renders = useMemo<Photo[]>(
    () =>
      images
        .filter((i) => isRender(i.category))
        .map((i) => ({ _id: i._id, image: i.image, alt: i.alt, kind: i.category as RenderKind, order: i.order }))
        .sort((a, b) => rank(a.kind) - rank(b.kind) || a.order - b.order),
    [images]
  );
  // Newest first (25 Nov 2026), like every stage under Progress.
  const newest = useMemo<Photo[]>(
    () => [...updates].sort((a, b) => b.order - a.order).map((u) => ({ _id: u._id, image: u.image, alt: u.alt, kind: "progress" as const, order: u.order })),
    [updates]
  );
  const tabs = useMemo<Exclude<GalleryTab, "all">[]>(
    () => [...RENDER_KINDS.filter((k) => renders.some((p) => p.kind === k)), ...(newest.length > 0 ? (["progress"] as const) : [])],
    [renders, newest]
  );

  const [tab, setTab] = useState<GalleryTab>(initial);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // The photos in the grid, in the buttons' order; the pop-up's Next and Previous follow the same order.
  const shown = useMemo<Photo[]>(
    () => (tab === "all" ? [...renders, ...newest.slice(0, PROGRESS_PREVIEW)] : tab === "progress" ? [] : renders.filter((p) => p.kind === tab)),
    [tab, renders, newest]
  );

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const showPrev = useCallback(
    () => setLightboxIndex((i) => (i === null ? null : (i - 1 + shown.length) % shown.length)),
    [shown.length]
  );
  const showNext = useCallback(
    () => setLightboxIndex((i) => (i === null ? null : (i + 1) % shown.length)),
    [shown.length]
  );
  const active = lightboxIndex !== null ? shown[lightboxIndex] : null;

  // The grid is a CSS multi-column layout (it fills each column top to bottom), so one grid holding every kind would
  // mix them across the rows. Under "All" each kind gets its own block, in the buttons' order.
  const groups = useMemo(() => {
    const out: Array<{ kind: Photo["kind"]; start: number; photos: Photo[] }> = [];
    shown.forEach((p, i) => {
      const last = out[out.length - 1];
      if (last && last.kind === p.kind) last.photos.push(p);
      else out.push({ kind: p.kind, start: i, photos: [p] });
    });
    return out;
  }, [shown]);

  function choose(next: GalleryTab) {
    setTab(next);
    setLightboxIndex(null);
  }

  // A photo is a button, so it can be reached and opened from the keyboard.
  function thumb(p: Photo, index: number) {
    return (
      <figure className={styles.figure} key={p._id}>
        <button type="button" className={styles.figureButton} onClick={() => setLightboxIndex(index)} aria-label={`View larger: ${p.alt}`}>
          <Image
            src={urlFor(p.image).width(640).url()}
            alt={p.alt}
            width={640}
            height={480}
            sizes="(max-width: 640px) 50vw, 33vw"
            priority={index === 0}
            loading={index < EAGER_PHOTOS ? "eager" : "lazy"}
          />
        </button>
      </figure>
    );
  }

  // One region for the tap check: a button changes the photos under it, Next changes the photo in the pop-up.
  return (
    <div data-visit-region style={{ display: "contents" }}>
      <div ref={top} className={styles.filters} role="group" aria-label="Show">
        <button className={tab === "all" ? styles.chipActive : styles.chip} aria-pressed={tab === "all"} onClick={() => choose("all")}>
          All
        </button>
        {tabs.map((t) => (
          <button key={t} className={tab === t ? styles.chipActive : styles.chip} aria-pressed={tab === t} onClick={() => choose(t)}>
            {LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "progress" ? (
        <div className={styles.progress}>
          {progressNote && <p className={styles.note}>{progressNote}</p>}
          {latest && <LatestUpdate report={latest} />}
          <div>
            <h2 className={styles.groupTitle}>Every photo from the site, newest first</h2>
            <ProgressGallery updates={updates} />
          </div>
        </div>
      ) : (
        <>
          {rendersNote && <p className={styles.note}>{rendersNote}</p>}
          {groups.map((g, gi) => (
            <section key={g.kind} className={styles.group} aria-label={LABEL[g.kind]} style={gi > 0 ? { marginTop: "var(--space-7)" } : undefined}>
              {tab === "all" && <h2 className={styles.groupTitle}>{g.kind === "progress" ? "Progress: the newest photos from the site" : LABEL[g.kind]}</h2>}
              <div className={styles.grid}>{g.photos.map((p, i) => thumb(p, g.start + i))}</div>
              {tab === "all" && g.kind === "progress" && newest.length > PROGRESS_PREVIEW && (
                <button
                  type="button"
                  className={styles.more}
                  onClick={() => {
                    choose("progress");
                    top.current?.scrollIntoView({ block: "start" });
                  }}
                >
                  See all {newest.length} photos from the site
                </button>
              )}
            </section>
          ))}
        </>
      )}

      {active && (
        <Lightbox
          src={urlFor(active.image).width(1600).url()}
          alt={active.alt}
          caption={active.alt}
          onClose={closeLightbox}
          onPrev={showPrev}
          onNext={showNext}
        />
      )}
    </div>
  );
}
