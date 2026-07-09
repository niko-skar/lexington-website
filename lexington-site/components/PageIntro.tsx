import { Reveal } from "./Reveal";
import styles from "./PageIntro.module.css";

interface PageIntroProps {
  eyebrow: string;
  title: string;
  lede?: string;
}

export function PageIntro({ eyebrow, title, lede }: PageIntroProps) {
  return (
    <section className={`sectionDark ${styles.intro}`}>
      <div className="wrap">
        <Reveal>
          <div className="eyebrow">{eyebrow}</div>
          <h1 className={styles.title}>{title}</h1>
          {lede && <p className={styles.lede}>{lede}</p>}
        </Reveal>
      </div>
    </section>
  );
}
