"use client";

import { useEffect } from "react";
import Image from "next/image";

import type { GalleryImage, Unit } from "@/lib/sanity/types";
import { urlFor } from "@/lib/sanity/image";
import { formatUSD } from "@/lib/format";
import { googleMapsUrl } from "@/lib/maps";
import { StatusBadge } from "./StatusBadge";
import buttonStyles from "./Button.module.css";
import styles from "./UnitDetailModal.module.css";

interface UnitDetailModalProps {
  unit: Unit;
  floorPlans: GalleryImage[];
  onClose: () => void;
}

// Duplex penthouse floor plans are captioned "... — lower floor" / "...
// upper floor (rooftop level)" — pull the part after the dash as a label
// whenever there's more than one plan to show for a unit.
function planLabel(alt: string) {
  const label = alt.split("—")[1]?.trim();
  if (!label) return null;
  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UnitDetailModal({ unit, floorPlans, onClose }: UnitDetailModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className={styles.head}>
          <div>
            <div className={styles.unitNumber}>{unit.unitNumber}</div>
            <div className={styles.meta}>
              Floor {unit.floor} · {unit.bedroomType} · {unit.areaSqm} sqm
            </div>
            <div className={styles.price}>{formatUSD(unit.priceUSD)}</div>
          </div>
          <StatusBadge status={unit.status} />
        </div>

        {floorPlans.length > 0 ? (
          <div className={styles.plans}>
            {floorPlans.map((plan) => (
              <div key={plan._id}>
                {floorPlans.length > 1 && (
                  <div className={styles.planLabel}>{planLabel(plan.alt)}</div>
                )}
                <div className={styles.imageWrap}>
                  <Image
                    src={urlFor(plan.image).width(900).url()}
                    alt={plan.alt}
                    width={900}
                    height={900}
                    sizes="(max-width: 720px) 100vw, 720px"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.noPlan}>
            Floor plan for this unit type is available on request.
          </p>
        )}

        <div className={styles.locationRow}>
          <span className={styles.locationText}>
            Shiashie, East Legon, Accra
          </span>
          <a
            href={googleMapsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonStyles.btn} ${buttonStyles.outlineDark}`}
          >
            View on Google Maps
          </a>
        </div>
      </div>
    </div>
  );
}
