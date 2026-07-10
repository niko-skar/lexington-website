"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";

import type { Unit } from "@/lib/sanity/types";
import { formatFloor, formatUSD } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import styles from "./CompareModal.module.css";

interface CompareModalProps {
  units: Unit[];
  onClose: () => void;
}

const rows: { label: string; render: (u: Unit) => ReactNode }[] = [
  { label: "Floor", render: (u) => formatFloor(u.floor) },
  { label: "Type", render: (u) => u.bedroomType },
  { label: "Area", render: (u) => `${u.areaSqm} sqm` },
  { label: "Price", render: (u) => formatUSD(u.priceUSD) },
  { label: "Status", render: (u) => <StatusBadge status={u.status} /> },
];

export function CompareModal({ units, onClose }: CompareModalProps) {
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
              {rows.map((row) => (
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
