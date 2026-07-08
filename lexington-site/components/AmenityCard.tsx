import type { Amenity } from "@/lib/sanity/types";
import { AmenityIcon } from "./AmenityIcon";
import { Reveal } from "./Reveal";
import styles from "./AmenityCard.module.css";

export function AmenityCardGrid({ amenities }: { amenities: Amenity[] }) {
  return (
    <div className={styles.grid}>
      {amenities.map((a, i) => (
        <Reveal key={a._id} delay={i * 40}>
          <div className={styles.card}>
            <div className={styles.iconWrap}>
              <AmenityIcon name={a.name} />
            </div>
            <span className={styles.name}>{a.name}</span>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
