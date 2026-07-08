"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./StatStrip.module.css";

export interface Stat {
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
}

function AnimatedStat({ value, prefix = "", suffix = "", label }: Stat) {
  const ref = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const prefersReducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        if (prefersReducedMotion) {
          setDisplay(value);
          return;
        }

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

  return (
    <div className={styles.stat} ref={ref}>
      <b>
        {prefix}
        {display.toLocaleString()}
        {suffix}
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
