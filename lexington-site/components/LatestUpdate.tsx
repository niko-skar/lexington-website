import Image from "next/image";

import { urlFor } from "@/lib/sanity/image";
import type { ProgressReport } from "@/lib/sanity/types";

import styles from "./LatestUpdate.module.css";

const SHOWN = 6;

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// The newest site update (posted from the progress reporter), above the full gallery:
// what's happening now, in Niko's words and photos. Each photo opens full size.
export function LatestUpdate({ report }: { report: ProgressReport }) {
  return (
    <div className={styles.latest}>
      <div>
        <div className="eyebrow">Latest from site</div>
        <div className={styles.date}>{longDate(report.date)}</div>
        <h2 className={styles.title}>{report.title}</h2>
        {report.text && <p className={styles.text}>{report.text}</p>}
      </div>
      <div className={styles.photos}>
        {report.photos.slice(0, SHOWN).map((p, i) => (
          <a key={p._key} href={urlFor(p.image).width(1800).url()} target="_blank" rel="noreferrer" aria-label={`View larger: ${p.alt}`}>
            <Image
              src={urlFor(p.image).width(640).height(800).fit("crop").url()}
              alt={p.alt}
              width={640}
              height={800}
              sizes="(max-width: 560px) 50vw, (max-width: 860px) 33vw, 20vw"
              priority={i < 3}
            />
          </a>
        ))}
      </div>
    </div>
  );
}
