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

// The first photos on the page are what the page "loads" on, so they are asked
// for straight away; the rest wait until they are scrolled near.
const EAGER_PHOTOS = 3;

export function Gallery({ images }: { images: GalleryImage[] }) {
  const categories = useMemo(
    () =>
      Array.from(new Set(images.map((i) => i.category))).filter(
        (c) => c !== "family"
      ),
    [images]
  );

  const [filter, setFilter] = useState<GalleryCategory | "all">("all");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const filtered = useMemo(
    () =>
      images
        .filter((i) => i.category !== "family")
        .filter((i) => filter === "all" || i.category === filter)
        // Progress (construction) photos always sort after every other
        // category in the "All" view — there are far more of them than
        // building/interior shots, so left to `order` alone they'd bury
        // the finished-building photos the gallery exists to showcase.
        .sort((a, b) => {
          const aLast = a.category === "progress" ? 1 : 0;
          const bLast = b.category === "progress" ? 1 : 0;
          return aLast !== bLast ? aLast - bLast : a.order - b.order;
        }),
    [images, filter]
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

  // `filtered` already sorts progress after everything else, but the grid
  // below is a CSS multi-column layout that balances by height across all
  // 3 columns — with far more progress photos than curated ones, that
  // balancing puts progress photos at the *top* of columns 2 and 3, right
  // next to row 1. Rendering progress as a second, separate grid forces a
  // hard break so it only appears once every curated photo has scrolled by.
  const progressSplit = filtered.findIndex((img) => img.category === "progress");
  const curatedShots = progressSplit === -1 ? filtered : filtered.slice(0, progressSplit);
  const progressShots = progressSplit === -1 ? [] : filtered.slice(progressSplit);

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

  return (
    <>
      <div className={styles.filters}>
        <button
          className={filter === "all" ? styles.chipActive : styles.chip}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            className={filter === c ? styles.chipActive : styles.chip}
            onClick={() => setFilter(c)}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className={styles.grid}>{curatedShots.map((img, i) => thumb(img, i))}</div>

      {progressShots.length > 0 && (
        <div className={styles.grid} style={{ marginTop: curatedShots.length > 0 ? "var(--space-6)" : 0 }}>
          {progressShots.map((img, i) => thumb(img, curatedShots.length + i))}
        </div>
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
    </>
  );
}
