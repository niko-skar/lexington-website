"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./StatStrip.module.css";

export interface Stat {
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  // Years (e.g. 2027) shouldn't get thousands-grouping — toLocaleString()
  // would render one as "2,027".
  noGrouping?: boolean;
}

function AnimatedStat({ value, prefix = "", suffix = "", label, noGrouping }: Stat) {
  const ref = useRef<HTMLDivElement>(null);
  // THE REAL NUMBER FIRST. This used to start at 0 and count up once scrolled
  // into view, so the page as search engines, screen readers and anyone without
  // JavaScript saw it read "0 of 32 units available, from $0". Now the real
  // figure is what the page says, and the count-up only happens for a stat that
  // starts below the fold.
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let primed = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // First answer: is it already on screen? Then leave the real number alone.
        if (!primed) {
          primed = true;
          if (entry.isIntersecting || prefersReducedMotion) {
            observer.disconnect();
            return;
          }
          // Below the fold: reset to 0 out of sight, count up when it arrives.
          setDisplay(0);
          return;
        }
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const duration = 900;
        const start = performance.now();

        function tick(now: number) {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setDisplay(Math.round(value * eased));
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [value]);

  // A fixed locale, so $72,000 is never "$72.000" on a German phone.
  const format = (n: number) => n.toLocaleString("en-US", noGrouping ? { useGrouping: false } : undefined);

  return (
    <div className={styles.stat} ref={ref}>
      <b>
        {/* The moving number is for the eyes only; screen readers get the real one
            from the line below, whatever the count-up is doing. */}
        <span aria-hidden="true">
          {prefix}
          {format(display)}
          {suffix}
        </span>
        <span className={styles.visuallyHidden}>
          {prefix}
          {format(value)}
          {suffix}
        </span>
      </b>
      <span>{label}</span>
    </div>
  );
}

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className={styles.strip}>
      {stats.map((stat) => (
        <AnimatedStat key={stat.label} {...stat} />
      ))}
    </div>
  );
}
