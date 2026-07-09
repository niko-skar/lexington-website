import Image from "next/image";

import type { FamilyMember } from "@/lib/sanity/types";
import { urlFor } from "@/lib/sanity/image";
import { Reveal } from "./Reveal";
import styles from "./LegacyTimeline.module.css";

export function LegacyTimeline({ members }: { members: FamilyMember[] }) {
  return (
    <div>
      {members.map((m, i) => (
        <Reveal key={m._id} delay={i * 80} className={styles.row}>
          {m.photo ? (
            <div className={styles.photo}>
              <Image
                src={urlFor(m.photo).width(200).height(200).url()}
                alt={m.name}
                width={200}
                height={200}
              />
            </div>
          ) : (
            <div className={styles.photo} />
          )}
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
