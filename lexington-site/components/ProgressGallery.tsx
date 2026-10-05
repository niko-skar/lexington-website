"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";

import type { ConstructionUpdate } from "@/lib/sanity/types";
import { urlFor } from "@/lib/sanity/image";
import styles from "./Gallery.module.css";
import { Lightbox } from "./Lightbox";

// The first photos on the page are what the page "loads" on, so they are asked
// for straight away; the rest wait until they are scrolled near.
const EAGER_PHOTOS = 3;

export function ProgressGallery({ updates }: { updates: ConstructionUpdate[] }) {
  // Stages aren't a fixed list (new ones get added in Studio as
  // construction reaches new floors), so derive the filter chips from
  // whatever data exists, in construction sequence (each stage's first
  // appearance in the already order-sorted `updates` array).
  const stages = useMemo(() => {
    const seen: string[] = [];
    for (const u of updates) {
      if (!seen.includes(u.stage)) seen.push(u.stage);
    }
    return seen;
  }, [updates]);

  const [filter, setFilter] = useState<string | "all">("all");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const filtered = useMemo(
    () => updates.filter((u) => filter === "all" || u.stage === filter),
    [updates, filter]
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

  return (
    <>
      <div className={styles.filters}>
        <button
          className={filter === "all" ? styles.chipActive : styles.chip}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {stages.map((s) => (
          <button
            key={s}
            className={filter === s ? styles.chipActive : styles.chip}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className={styles.grid}>
        {filtered.map((u, i) => (
          <figure className={styles.figure} key={u._id}>
            <button
              type="button"
              className={styles.figureButton}
              onClick={() => setLightboxIndex(i)}
              aria-label={`View larger: ${u.alt}`}
            >
              <Image
                src={urlFor(u.image).width(640).url()}
                alt={u.alt}
                width={640}
                height={480}
                sizes="(max-width: 640px) 50vw, 33vw"
                priority={i === 0}
                loading={i < EAGER_PHOTOS ? "eager" : "lazy"}
              />
            </button>
          </figure>
        ))}
      </div>

      {active && (
        <Lightbox
          src={urlFor(active.image).width(1600).url()}
          alt={active.alt}
          caption={`${active.stage} — ${active.alt}`}
          onClose={closeLightbox}
          onPrev={showPrev}
          onNext={showNext}
        />
      )}
    </>
  );
}
