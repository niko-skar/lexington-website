import { Reveal } from "./Reveal";
import styles from "./FeatureGrid.module.css";

export interface FeatureItem {
  key: string;
  label: string;
  title: string;
}

export function FeatureGrid({ items }: { items: FeatureItem[] }) {
  return (
    <div className={styles.grid}>
      {items.map((item, i) => (
        <Reveal key={item.key} delay={i * 40}>
          <div className={styles.card}>
            <span className={styles.idx}>{item.label}</span>
            <h3>{item.title}</h3>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
