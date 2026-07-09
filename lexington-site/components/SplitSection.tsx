import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { Reveal } from "./Reveal";
import styles from "./SplitSection.module.css";

interface SplitSectionProps {
  imageUrl: string;
  imageAlt: string;
  reverse?: boolean;
  eyebrow: string;
  title: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function SplitSection({
  imageUrl,
  imageAlt,
  reverse,
  eyebrow,
  title,
  children,
  style,
}: SplitSectionProps) {
  return (
    <section className="section" style={style}>
      <div className={`wrap ${styles.split} ${reverse ? styles.reverse : ""}`}>
        <Reveal className={styles.media}>
          <Image
            src={imageUrl}
            alt={imageAlt}
            width={800}
            height={1000}
            sizes="(max-width: 880px) 100vw, 50vw"
          />
        </Reveal>
        <Reveal delay={120}>
          <div className="eyebrow">{eyebrow}</div>
          <h2 className={styles.title}>{title}</h2>
          <div className={styles.body}>{children}</div>
        </Reveal>
      </div>
    </section>
  );
}
