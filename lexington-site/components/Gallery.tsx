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
        .filter((i) => filter === "all" || i.category === filter),
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
        {filtered.map((img, i) => (
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
