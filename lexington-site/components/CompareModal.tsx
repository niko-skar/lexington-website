"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

import type { PackageTier, Unit } from "@/lib/sanity/types";
import { formatFloor, formatUSD } from "@/lib/format";
import { floorTierName, isTierClamped, priceAtTier, tierAddon } from "@/lib/pricing";
import { StatusBadge } from "./StatusBadge";
import styles from "./CompareModal.module.css";

interface CompareModalProps {
  units: Unit[];
  tiers: PackageTier[];
  onClose: () => void;
}

const baseRows: { label: string; render: (u: Unit) => ReactNode }[] = [
  { label: "Floor", render: (u) => formatFloor(u.floor) },
  { label: "Type", render: (u) => u.bedroomType },
  { label: "Area", render: (u) => `${u.areaSqm} sqm` },
  { label: "Status", render: (u) => <StatusBadge status={u.status} /> },
];

export function CompareModal({ units, tiers, onClose }: CompareModalProps) {
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

        <div className={styles.title}>Compare units</div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.rowLabel}></th>
                {units.map((u) => (
                  <th key={u._id} className={styles.unitHead}>
                    {u.unitNumber}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {baseRows.slice(0, 3).map((row) => (
                <tr key={row.label}>
                  <td className={styles.rowLabel}>{row.label}</td>
                  {units.map((u) => (
                    <td key={u._id}>{row.render(u)}</td>
                  ))}
                </tr>
              ))}
              {tiers.map((tier) => (
                <tr key={tier.key}>
                  <td className={styles.rowLabel}>{tier.name} price</td>
                  {units.map((u) => {
                    const clamped = isTierClamped(u, tier.key, tiers);
                    const addon = tierAddon(u, tier.key, tiers);
                    return (
                      <td key={u._id}>
                        {formatUSD(priceAtTier(u, tier.key, tiers))}
                        {clamped ? (
                          <span className={styles.priceNote}>
                            {floorTierName(u, tiers)} included as standard
                          </span>
                        ) : (
                          addon > 0 && (
                            <span className={styles.priceBreakdown}>
                              {formatUSD(u.priceUSD)} + {formatUSD(addon)}
                            </span>
                          )
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {baseRows.slice(3).map((row) => (
                <tr key={row.label}>
                  <td className={styles.rowLabel}>{row.label}</td>
                  {units.map((u) => (
                    <td key={u._id}>{row.render(u)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
