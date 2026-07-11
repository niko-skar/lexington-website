"use client";

import type { PackageTier, PackageTierKey } from "@/lib/sanity/types";
import styles from "./PackageTiers.module.css";

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.5L6.2 11.5L13 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface PackageTiersProps {
  tiers: PackageTier[];
  selected: PackageTierKey;
  onSelect: (key: PackageTierKey) => void;
}

export function PackageTiers({ tiers, selected, onSelect }: PackageTiersProps) {
  if (tiers.length === 0) return null;

  return (
    <div>
      <div className="eyebrow">Apartment Packages</div>
      <h2 className={styles.heading}>Choose your finish package.</h2>
      <p className={styles.lede}>
        Every residence ships with our Standard finish. Upgrade to Premium or Premium Plus for
        finer materials, smart-home control, and enhanced sound and security — prices below
        update to match.
      </p>

      <div className={styles.tiers} role="group" aria-label="Finish package">
        {tiers.map((tier, i) => (
          <button
            key={tier.key}
            type="button"
            className={styles.tier}
            aria-pressed={selected === tier.key}
            onClick={() => onSelect(tier.key)}
          >
            <span className={styles.radio} aria-hidden="true" />
            <div className={styles.name}>
              {tier.name}
              {tier.badge && <span className={styles.badge}>{tier.badge}</span>}
            </div>
            <div className={styles.price}>
              {tier.ratePerSqm === 0 ? (
                <>
                  Included<small>in every unit</small>
                </>
              ) : (
                <>
                  +${tier.ratePerSqm.toLocaleString()}
                  <small>per sqm</small>
                </>
              )}
            </div>
            {tier.description && <div className={styles.desc}>{tier.description}</div>}
            {tier.features.length > 0 && (
              <div className={styles.includes}>
                <div className={styles.includesLabel}>
                  {i === 0 ? "Includes" : `Everything in ${tiers[i - 1].name}, plus`}
                </div>
                <ul>
                  {tier.features.map((f) => (
                    <li key={f}>
                      <CheckIcon />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tier.note && <div className={styles.note}>{tier.note}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
