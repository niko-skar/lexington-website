"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import styles from "./Hero.module.css";

interface HeroProps {
  imageUrl: string;
  imageAlt: string;
  eyebrow: string;
  children: ReactNode;
}

export function Hero({ imageUrl, imageAlt, eyebrow, children }: HeroProps) {
  const imgWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion) return;

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (imgWrapRef.current) {
          imgWrapRef.current.style.transform = `translate3d(0, ${y * 0.25}px, 0) scale(1.08)`;
        }
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className={styles.hero}>
      <div className={styles.media} ref={imgWrapRef}>
        <Image src={imageUrl} alt={imageAlt} fill priority sizes="100vw" style={{ objectFit: "cover" }} />
      </div>
      <div className={`wrap ${styles.content}`}>
        <div className={styles.eyebrow}>{eyebrow}</div>
        {children}
      </div>
      <div className={styles.scrollHint}>Scroll</div>
    </section>
  );
}
