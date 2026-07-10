"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import type { GalleryCategory, GalleryImage } from "@/lib/sanity/types";
import { urlFor } from "@/lib/sanity/image";
import styles from "./Gallery.module.css";

const CATEGORY_LABEL: Record<GalleryCategory, string> = {
  exterior: "Exterior",
  interior: "Interior",
  amenity: "Amenity",
  floorplan: "Floorplan",
  family: "Family",
  progress: "Progress",
};

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

  const closeLightbox = () => setLightboxIndex(null);
  const showPrev = () =>
    setLightboxIndex((i) => (i === null ? null : (i - 1 + filtered.length) % filtered.length));
  const showNext = () =>
    setLightboxIndex((i) => (i === null ? null : (i + 1) % filtered.length));

  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, filtered.length]);

  const touchStartX = useRef(0);
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) < 40) return;
    if (dx > 0) showPrev();
    else showNext();
  }

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

      <div className={styles.grid}>
        {curatedShots.map((img, i) => (
          <figure
            className={styles.figure}
            key={img._id}
            onClick={() => setLightboxIndex(i)}
          >
            <Image
              src={urlFor(img.image).width(640).url()}
              alt={img.alt}
              width={640}
              height={480}
              sizes="(max-width: 640px) 50vw, 33vw"
            />
          </figure>
        ))}
      </div>

      {progressShots.length > 0 && (
        <div className={styles.grid} style={{ marginTop: curatedShots.length > 0 ? "var(--space-6)" : 0 }}>
          {progressShots.map((img, i) => (
            <figure
              className={styles.figure}
              key={img._id}
              onClick={() => setLightboxIndex(curatedShots.length + i)}
            >
              <Image
                src={urlFor(img.image).width(640).url()}
                alt={img.alt}
                width={640}
                height={480}
                sizes="(max-width: 640px) 50vw, 33vw"
              />
            </figure>
          ))}
        </div>
      )}

      {active && (
        <div
          className={styles.lightbox}
          onClick={closeLightbox}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          role="dialog"
          aria-modal="true"
        >
          <button
            className={styles.close}
            onClick={closeLightbox}
            aria-label="Close"
          >
            ×
          </button>
          <button
            className={styles.navPrev}
            onClick={(e) => {
              e.stopPropagation();
              showPrev();
            }}
            aria-label="Previous image"
          >
            ‹
          </button>
          <div className={styles.lightboxImageWrap} onClick={(e) => e.stopPropagation()}>
            <Image
              src={urlFor(active.image).width(1600).url()}
              alt={active.alt}
              width={1600}
              height={1200}
              sizes="90vw"
              className={styles.lightboxImage}
            />
            <p className={styles.caption}>{active.alt}</p>
          </div>
          <button
            className={styles.navNext}
            onClick={(e) => {
              e.stopPropagation();
              showNext();
            }}
            aria-label="Next image"
          >
            ›
          </button>
        </div>
      )}
    </>
  );
}
