"use client";

import { useEffect, type ReactNode } from "react";

import type { PackageTier, Unit } from "@/lib/sanity/types";
import { trackAction } from "@/lib/visits/client";
import { formatFloor, formatUSD } from "@/lib/format";
import { formatArea, type AreaUnit } from "@/lib/area";
import { useAreaUnit } from "./useAreaUnit";
import { floorTierName, isTierClamped, priceAtTier, tierAddon } from "@/lib/pricing";
import { withVat, type Vat } from "@/lib/vat";

import { VatNote, VatTag } from "./Vat";
import { StatusBadge } from "./StatusBadge";
import { useDialog } from "./useDialog";
import styles from "./CompareModal.module.css";

interface CompareModalProps {
  units: Unit[];
  tiers: PackageTier[];
  vat: Vat;
  onClose: () => void;
}

const baseRows: { label: string; render: (u: Unit, area: AreaUnit) => ReactNode }[] = [
  { label: "Floor", render: (u) => formatFloor(u.floor) },
  { label: "Type", render: (u) => u.bedroomType },
  { label: "Area", render: (u, area) => formatArea(u.areaSqm, area) },
  { label: "Status", render: (u) => <StatusBadge status={u.status} /> },
];

export function CompareModal({ units, tiers, vat, onClose }: CompareModalProps) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const areaUnit = useAreaUnit();

  useEffect(() => {
    trackAction("compare");
  }, []);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Compare units"
    >
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
                    <td key={u._id}>{row.render(u, areaUnit)}</td>
                  ))}
                </tr>
              ))}
              {tiers.map((tier) => (
                <tr key={tier.key}>
                  <td className={styles.rowLabel}>{tier.name} price</td>
                  {units.map((u) => {
                    const clamped = isTierClamped(u, tier.key, tiers);
                    const addon = tierAddon(u, tier.key, tiers);
                    // As people see them: with the VAT in it while VAT is on.
                    const shown = withVat(priceAtTier(u, tier.key, tiers), vat);
                    const base = withVat(u.priceUSD, vat);
                    return (
                      <td key={u._id}>
                        {formatUSD(shown)}
                        <VatTag vat={vat} />
                        {clamped ? (
                          <span className={styles.priceNote}>
                            {floorTierName(u, tiers)} included as standard
                          </span>
                        ) : (
                          addon > 0 && (
                            <span className={styles.priceBreakdown}>
                              {formatUSD(base)} + {formatUSD(shown - base)}
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
                    <td key={u._id}>{row.render(u, areaUnit)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <VatNote vat={vat} />
        </div>
      </div>
    </div>
  );
}
