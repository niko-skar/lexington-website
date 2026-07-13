"use client";

import { useMemo, useState } from "react";

import type {
  BedroomType,
  GalleryImage,
  PackageTier,
  PackageTierKey,
  Unit,
  UnitLocationPlan,
  UnitStatus,
} from "@/lib/sanity/types";
import { formatFloor, formatUSD } from "@/lib/format";
import { floorTierName, isTierClamped, priceAtTier, tierAddon } from "@/lib/pricing";
import { StatusBadge } from "./StatusBadge";
import { UnitDetailModal } from "./UnitDetailModal";
import { CompareModal } from "./CompareModal";
import { PackageTiers } from "./PackageTiers";
import styles from "./UnitFinder.module.css";

type FloorFilter = number | "all";
type TypeFilter = BedroomType | "all";
type StatusFilter = UnitStatus | "all";
type SortColumn = "floor" | "type" | "area" | "price" | "status";
type SortDir = "asc" | "desc";

const MAX_COMPARE = 4;

// Alphabetical order happens to already read available < reserved < sold,
// but spelling it out keeps that from being an accident future edits break.
const STATUS_ORDER: Record<UnitStatus, number> = { available: 0, reserved: 1, sold: 2 };

interface UnitFinderProps {
  units: Unit[];
  floorPlans: Record<BedroomType, GalleryImage[]>;
  locationPlanByUnit: Record<string, UnitLocationPlan>;
  tiers: PackageTier[];
}

export function UnitFinder({ units, floorPlans, locationPlanByUnit, tiers }: UnitFinderProps) {
  const [floor, setFloor] = useState<FloorFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [selectedTier, setSelectedTier] = useState<PackageTierKey>("standard");
  // null sortColumn means "default order" — whatever seed/floor order the
  // units arrived in, unchanged until someone clicks a header.
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  const sorted = useMemo(() => {
    if (!sortColumn) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortColumn) {
        case "floor":
          return (a.floor - b.floor) * dir;
        case "type":
          return a.bedroomType.localeCompare(b.bedroomType) * dir;
        case "area":
          return (a.areaSqm - b.areaSqm) * dir;
        case "price":
          return (priceAtTier(a, selectedTier, tiers) - priceAtTier(b, selectedTier, tiers)) * dir;
        case "status":
          return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * dir;
      }
    });
  }, [filtered, sortColumn, sortDir, selectedTier, tiers]);

  const availableInFiltered = filtered.filter((u) => u.status === "available").length;

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("asc");
    }
  }

  function sortIndicator(column: SortColumn) {
    if (sortColumn !== column) return null;
    return <span aria-hidden="true">{sortDir === "asc" ? " ▲" : " ▼"}</span>;
  }

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  }

  const compareUnits = units.filter((u) => compareIds.includes(u._id));

  return (
    <div>
      <div className={styles.packages}>
        <PackageTiers tiers={tiers} selected={selectedTier} onSelect={setSelectedTier} />
      </div>

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
                {formatFloor(f)}
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
              <th className={styles.checkboxCol}>Compare</th>
              <th>Unit</th>
              <th aria-sort={sortColumn === "floor" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button className={styles.sortButton} onClick={() => handleSort("floor")}>
                  Floor{sortIndicator("floor")}
                </button>
              </th>
              <th aria-sort={sortColumn === "type" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button className={styles.sortButton} onClick={() => handleSort("type")}>
                  Type{sortIndicator("type")}
                </button>
              </th>
              <th aria-sort={sortColumn === "area" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button className={styles.sortButton} onClick={() => handleSort("area")}>
                  Area{sortIndicator("area")}
                </button>
              </th>
              <th aria-sort={sortColumn === "price" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button className={styles.sortButton} onClick={() => handleSort("price")}>
                  Price{sortIndicator("price")}
                </button>
              </th>
              <th aria-sort={sortColumn === "status" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button className={styles.sortButton} onClick={() => handleSort("status")}>
                  Status{sortIndicator("status")}
                </button>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => {
              const checked = compareIds.includes(u._id);
              const clamped = isTierClamped(u, selectedTier, tiers);
              const addon = tierAddon(u, selectedTier, tiers);
              return (
                <tr
                  key={u._id}
                  className={styles.clickableRow}
                  tabIndex={0}
                  onClick={() => setSelectedUnit(u)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedUnit(u);
                    }
                  }}
                >
                  <td className={styles.checkboxCol}>
                    <label className={styles.compareCellLabel} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className={styles.compareCheckbox}
                        checked={checked}
                        onChange={() => toggleCompare(u._id)}
                        disabled={!checked && compareIds.length >= MAX_COMPARE}
                        aria-label={`Add ${u.unitNumber} to compare`}
                      />
                    </label>
                  </td>
                  <td>{u.unitNumber}</td>
                  <td>{formatFloor(u.floor)}</td>
                  <td>{u.bedroomType}</td>
                  <td>{u.areaSqm} sqm</td>
                  <td className={styles.price}>
                    {formatUSD(priceAtTier(u, selectedTier, tiers))}
                    {clamped ? (
                      <span className={styles.priceNote}>{floorTierName(u, tiers)} included as standard</span>
                    ) : (
                      addon > 0 && (
                        <span className={styles.priceBreakdown}>
                          {formatUSD(u.priceUSD)} + {formatUSD(addon)}
                        </span>
                      )
                    )}
                  </td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td>
                    <span className={styles.planLink}>Floor Plan</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.cards}>
        {sorted.map((u) => {
          const checked = compareIds.includes(u._id);
          const clamped = isTierClamped(u, selectedTier, tiers);
          const addon = tierAddon(u, selectedTier, tiers);
          return (
            <div
              className={`${styles.card} ${styles.clickableRow}`}
              key={u._id}
              tabIndex={0}
              onClick={() => setSelectedUnit(u)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedUnit(u);
                }
              }}
            >
              <div className={styles.cardHead}>
                <span className={styles.cardUnit}>{u.unitNumber}</span>
                <StatusBadge status={u.status} />
              </div>
              <div className={styles.cardMeta}>
                Floor {formatFloor(u.floor)} · {u.bedroomType} · {u.areaSqm} sqm
              </div>
              <div className={styles.cardPrice}>
                {formatUSD(priceAtTier(u, selectedTier, tiers))}
                {clamped ? (
                  <span className={styles.priceNote}>{floorTierName(u, tiers)} included as standard</span>
                ) : (
                  addon > 0 && (
                    <span className={styles.priceBreakdown}>
                      {formatUSD(u.priceUSD)} + {formatUSD(addon)}
                    </span>
                  )
                )}
              </div>
              <div className={styles.cardActions}>
                <span className={styles.planLink}>View Floor Plan &amp; Location</span>
                <label className={styles.compareLabel} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCompare(u._id)}
                    disabled={!checked && compareIds.length >= MAX_COMPARE}
                  />
                  Compare
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className={styles.empty}>No units match these filters.</p>
      )}

      {selectedUnit && (
        <UnitDetailModal
          unit={selectedUnit}
          floorPlans={floorPlans[selectedUnit.bedroomType]}
          locationPlan={locationPlanByUnit[selectedUnit.unitNumber]}
          tiers={tiers}
          selectedTier={selectedTier}
          onClose={() => setSelectedUnit(null)}
        />
      )}

      {compareUnits.length > 0 && (
        <div className={styles.compareBar}>
          <span className={styles.compareBarCount}>
            {compareUnits.length} of {MAX_COMPARE} selected — {compareUnits.map((u) => u.unitNumber).join(", ")}
          </span>
          <div className={styles.compareBarActions}>
            <button className={styles.compareBarClear} onClick={() => setCompareIds([])}>
              Clear
            </button>
            <button
              className={styles.compareBarButton}
              disabled={compareUnits.length < 2}
              onClick={() => setShowCompare(true)}
            >
              Compare {compareUnits.length > 1 ? `(${compareUnits.length})` : ""}
            </button>
          </div>
        </div>
      )}

      {showCompare && compareUnits.length > 0 && (
        <CompareModal units={compareUnits} tiers={tiers} onClose={() => setShowCompare(false)} />
      )}
    </div>
  );
}
