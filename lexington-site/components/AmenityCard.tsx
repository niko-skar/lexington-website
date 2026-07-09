import Image from "next/image";

import type { Amenity, GalleryImage } from "@/lib/sanity/types";
import { urlFor } from "@/lib/sanity/image";
import { Reveal } from "./Reveal";
import styles from "./AmenityCard.module.css";

function pickImage(name: string, images: GalleryImage[]) {
  const key = name.toLowerCase();
  const find = (needle: string) => images.find((i) => i.alt.toLowerCase().includes(needle));

  if (key.includes("pool")) return find("pool");
  if (key.includes("gym")) return find("gym");
  if (key.includes("jacuzzi") || key.includes("sauna") || key.includes("ice"))
    return find("jacuzzi");
  if (key.includes("caf")) return find("café") ?? find("cafe");
  if (key.includes("garden")) return find("rooftop terrace") ?? find("rooftop");
  return images[0];
}

export function AmenityCardGrid({
  amenities,
  images,
}: {
  amenities: Amenity[];
  images: GalleryImage[];
}) {
  return (
    <div className={styles.grid}>
      {amenities.map((a, i) => {
        const image = pickImage(a.name, images);
        return (
          <Reveal key={a._id} delay={i * 40}>
            <div className={styles.card}>
              {image && (
                <Image
                  src={urlFor(image.image).width(480).height(600).url()}
                  alt={image.alt}
                  width={480}
                  height={600}
                />
              )}
              <span className={styles.name}>{a.name}</span>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}
