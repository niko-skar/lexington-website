"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import styles from "./Gallery.module.css";
import { useDialog } from "./useDialog";

// The full-screen photo viewer shared by the Gallery and the Progress page.
// Arrow keys and swipes step through the photos; Escape and the × close it.
export function Lightbox({
  src,
  alt,
  caption,
  onClose,
  onPrev,
  onNext,
}: {
  src: string;
  alt: string;
  caption: string;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const touchStartX = useRef(0);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") onPrev();
      if (event.key === "ArrowRight") onNext();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onPrev, onNext]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={styles.lightbox}
      onClick={onClose}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        if (Math.abs(dx) < 40) return;
        if (dx > 0) onPrev();
        else onNext();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      <button className={styles.close} onClick={onClose} aria-label="Close">
        ×
      </button>
      <button
        className={styles.navPrev}
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        aria-label="Previous image"
      >
        ‹
      </button>
      <div className={styles.lightboxImageWrap} onClick={(e) => e.stopPropagation()}>
        <Image src={src} alt={alt} width={1600} height={1200} sizes="90vw" className={styles.lightboxImage} />
        <p className={styles.caption}>{caption}</p>
      </div>
      <button
        className={styles.navNext}
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        aria-label="Next image"
      >
        ›
      </button>
    </div>
  );
}
