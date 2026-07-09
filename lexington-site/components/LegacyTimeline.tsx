import type { FamilyMember } from "@/lib/sanity/types";
import { Reveal } from "./Reveal";
import styles from "./LegacyTimeline.module.css";

export function LegacyTimeline({ members }: { members: FamilyMember[] }) {
  return (
    <div>
      {members.map((m, i) => (
        <Reveal key={m._id} delay={i * 80} className={styles.row}>
          <div className={styles.years}>{m.years}</div>
          <div>
            <h3>{m.name}</h3>
            <p>{m.bio}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
