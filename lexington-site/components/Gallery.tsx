"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";

import type { GalleryCategory, GalleryImage } from "@/lib/sanity/types";
import { urlFor } from "@/lib/sanity/image";
import styles from "./Gallery.module.css";
import { Lightbox } from "./Lightbox";

const CATEGORY_LABEL: Record<GalleryCategory, string> = {
  exterior: "Exterior",
  interior: "Interior",
  amenity: "Amenity",
  floorplan: "Floorplan",
  family: "Family",
  progress: "Progress",
};

/**
 * The order of the buttons, and of the photos under "All" (Niko, 25 Nov 2026: "reorder the gallery photos so it follows
 * the order of the buttons. Exterior first, interior, then amenities and so on"). Family photos are never shown.
 */
const CATEGORY_ORDER: readonly GalleryCategory[] = ["exterior", "interior", "amenity", "floorplan", "progress"];
const rank = (c: GalleryCategory) => {
  const i = CATEGORY_ORDER.indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
};

// The first photos on the page are what the page "loads" on, so they are asked
// for straight away; the rest wait until they are scrolled near.
const EAGER_PHOTOS = 3;

export function Gallery({ images }: { images: GalleryImage[] }) {
  const shown = useMemo(() => images.filter((i) => CATEGORY_ORDER.includes(i.category)), [images]);
  const categories = useMemo(() => CATEGORY_ORDER.filter((c) => shown.some((i) => i.category === c)), [shown]);

  const [filter, setFilter] = useState<GalleryCategory | "all">("all");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // In the buttons' order, then each category's own order; the pop-up's Next and Previous follow the same order.
  const filtered = useMemo(
    () =>
      shown
        .filter((i) => filter === "all" || i.category === filter)
        .sort((a, b) => rank(a.category) - rank(b.category) || a.order - b.order),
    [shown, filter]
  );

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const showPrev = useCallback(
    () => setLightboxIndex((i) => (i === null ? null : (i - 1 + filtered.length) % filtered.length)),
    [filtered.length]
  );
  const showNext = useCallback(
    () => setLightboxIndex((i) => (i === null ? null : (i + 1) % filtered.length)),
    [filtered.length]
  );

  const active = lightboxIndex !== null ? filtered[lightboxIndex] : null;

  // The grid is a CSS multi-column layout (it fills each column top to bottom), so one grid holding every category
  // would mix them across the rows. Under "All" each category gets its own block, in the buttons' order.
  const groups = useMemo(() => {
    const out: Array<{ category: GalleryCategory; start: number; photos: GalleryImage[] }> = [];
    filtered.forEach((img, i) => {
      const last = out[out.length - 1];
      if (last && last.category === img.category) last.photos.push(img);
      else out.push({ category: img.category, start: i, photos: [img] });
    });
    return out;
  }, [filtered]);

  // A photo is a button, so it can be reached and opened from the keyboard.
  function thumb(img: GalleryImage, index: number) {
    return (
      <figure className={styles.figure} key={img._id}>
        <button
          type="button"
          className={styles.figureButton}
          onClick={() => setLightboxIndex(index)}
          aria-label={`View larger: ${img.alt}`}
        >
          <Image
            src={urlFor(img.image).width(640).url()}
            alt={img.alt}
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

  // One region for the tap check: a filter changes the photos under it, Next changes the photo in the pop-up.
  return (
    <div data-visit-region style={{ display: "contents" }}>
      <div className={styles.filters}>
        <button
          className={filter === "all" ? styles.chipActive : styles.chip}
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            className={filter === c ? styles.chipActive : styles.chip}
            aria-pressed={filter === c}
            onClick={() => setFilter(c)}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      {groups.map((g, gi) => (
        <section key={g.category} className={styles.group} aria-label={CATEGORY_LABEL[g.category]} style={gi > 0 ? { marginTop: "var(--space-7)" } : undefined}>
          {filter === "all" && <h2 className={styles.groupTitle}>{CATEGORY_LABEL[g.category]}</h2>}
          <div className={styles.grid}>{g.photos.map((img, i) => thumb(img, g.start + i))}</div>
        </section>
      ))}

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
