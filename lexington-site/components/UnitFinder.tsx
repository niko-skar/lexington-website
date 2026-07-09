"use client";

import { useMemo, useState } from "react";

import type { BedroomType, GalleryImage, Unit, UnitStatus } from "@/lib/sanity/types";
import { formatUSD } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { UnitDetailModal } from "./UnitDetailModal";
import styles from "./UnitFinder.module.css";

type FloorFilter = number | "all";
type TypeFilter = BedroomType | "all";
type StatusFilter = UnitStatus | "all";

interface UnitFinderProps {
  units: Unit[];
  floorPlans: Record<BedroomType, GalleryImage[]>;
}

export function UnitFinder({ units, floorPlans }: UnitFinderProps) {
  const [floor, setFloor] = useState<FloorFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);

  const floors = useMemo(
    () => Array.from(new Set(units.map((u) => u.floor))).sort((a, b) => a - b),
    [units]
  );

  const types = useMemo(
    () => Array.from(new Set(units.map((u) => u.bedroomType))),
    [units]
  );

  const filtered = useMemo(
    () =>
      units.filter(
        (u) =>
          (floor === "all" || u.floor === floor) &&
          (type === "all" || u.bedroomType === type) &&
          (status === "all" || u.status === status)
      ),
    [units, floor, type, status]
  );

  const availableInFiltered = filtered.filter((u) => u.status === "available").length;

  return (
    <div>
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Floor</span>
          <div className={styles.pills}>
            <button
              className={floor === "all" ? styles.pillActive : styles.pill}
              onClick={() => setFloor("all")}
            >
              All
            </button>
            {floors.map((f) => (
              <button
                key={f}
                className={floor === f ? styles.pillActive : styles.pill}
                onClick={() => setFloor(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Type</span>
          <div className={styles.pills}>
            <button
              className={type === "all" ? styles.pillActive : styles.pill}
              onClick={() => setType("all")}
            >
              All
            </button>
            {types.map((t) => (
              <button
                key={t}
                className={type === t ? styles.pillActive : styles.pill}
                onClick={() => setType(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Status</span>
          <div className={styles.pills}>
            {(["all", "available", "reserved", "sold"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                className={status === s ? styles.pillActive : styles.pill}
                onClick={() => setStatus(s)}
              >
                {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.count}>
        {availableInFiltered} of {filtered.length} shown are available
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Floor</th>
              <th>Type</th>
              <th>Area</th>
              <th>Price</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u._id}>
                <td>{u.unitNumber}</td>
                <td>{u.floor}</td>
                <td>{u.bedroomType}</td>
                <td>{u.areaSqm} sqm</td>
                <td className={styles.price}>{formatUSD(u.priceUSD)}</td>
                <td>
                  <StatusBadge status={u.status} />
                </td>
                <td>
                  <button className={styles.planLink} onClick={() => setSelectedUnit(u)}>
                    Floor Plan
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.cards}>
        {filtered.map((u) => (
          <div className={styles.card} key={u._id}>
            <div className={styles.cardHead}>
              <span className={styles.cardUnit}>{u.unitNumber}</span>
              <StatusBadge status={u.status} />
            </div>
            <div className={styles.cardMeta}>
              Floor {u.floor} · {u.bedroomType} · {u.areaSqm} sqm
            </div>
            <div className={styles.cardPrice}>{formatUSD(u.priceUSD)}</div>
            <button className={styles.planLink} onClick={() => setSelectedUnit(u)}>
              View Floor Plan &amp; Location
            </button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className={styles.empty}>No units match these filters.</p>
      )}

      {selectedUnit && (
        <UnitDetailModal
          unit={selectedUnit}
          floorPlans={floorPlans[selectedUnit.bedroomType]}
          onClose={() => setSelectedUnit(null)}
        />
      )}
    </div>
  );
}
