import Image from "next/image";

import type { GalleryImage } from "@/lib/sanity/types";
import { urlFor } from "@/lib/sanity/image";
import { Reveal } from "./Reveal";
import styles from "./PhotoTriptych.module.css";

export function PhotoTriptych({
  images,
  caption,
}: {
  images: GalleryImage[];
  caption?: string;
}) {
  if (images.length === 0) return null;

  return (
    <Reveal>
      <div className={styles.grid}>
        {images.slice(0, 3).map((img) => (
          <div className={styles.frame} key={img._id}>
            <Image
              src={urlFor(img.image).width(500).height(650).url()}
              alt={img.alt}
              width={500}
              height={650}
            />
          </div>
        ))}
      </div>
      {caption && <p className={styles.caption}>{caption}</p>}
    </Reveal>
  );
}
