import type { ReactNode } from "react";

import styles from "./Dashboard.module.css";
import { niceTop } from "./scale";

/* --- Words and numbers ----------------------------------------------------------------- */

export function formatMoney(amount: number, currency = "USD"): string {
  const whole = Math.abs(amount) >= 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** A share as a percentage with one decimal: 0.0234 -> "2.3%". */
export function formatShare(share: number | null): string {
  return share == null ? "—" : `${(share * 100).toFixed(1)}%`;
}

export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function countryName(code: string | null | undefined): string {
  if (!code) return "Unknown country";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function deviceName(device: string | null | undefined): string {
  return device === "phone" ? "Phone" : device === "tablet" ? "Tablet" : device === "desktop" ? "Computer" : "Unknown device";
}

export function browserName(browser: string | null | undefined): string | null {
  if (!browser || browser === "other") return null;
  return browser === "samsung" ? "Samsung Internet" : `${browser[0].toUpperCase()}${browser.slice(1)}`;
}

/* --- Number tiles ----------------------------------------------------------------------- */

export interface TileData {
  label: string;
  value: string;
  hint?: ReactNode;
  warn?: boolean;
}

export function Tiles({ tiles }: { tiles: TileData[] }) {
  return (
    <dl className={styles.tiles}>
      {tiles.map((tile) => (
        <div key={tile.label} className={tile.warn ? styles.tileWarn : styles.tile}>
          <dt className={styles.tileLabel}>{tile.label}</dt>
          <dd className={styles.tileValue}>{tile.value}</dd>
          {tile.hint && <dd className={styles.tileHint}>{tile.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/* --- Day columns --------------------------------------------------------------------------- */

export interface DayPoint {
  day: string;
  value: number;
  /** Extra words for the tooltip and the table ("3 got in touch"). */
  note?: string;
}

/**
 * One measure, one column a day, in the one chart colour. The tallest day and
 * the last day carry their value; every day shows it on hover or focus, and the
 * whole series is in the table under "Show as table".
 */
export function DayColumns({
  title,
  points,
  format,
  total,
  integer = true,
}: {
  title: string;
  points: DayPoint[];
  format: (n: number) => string;
  total?: string;
  integer?: boolean;
}) {
  const max = Math.max(0, ...points.map((point) => point.value));
  const top = niceTop(max, integer);
  const last = points.length - 1;
  let tallest = -1;
  points.forEach((point, index) => {
    if (point.value > 0 && (tallest < 0 || point.value > points[tallest].value)) tallest = index;
  });
  const labelled = new Set<number>();
  if (points[last]?.value > 0) labelled.add(last);
  if (tallest >= 0 && last - tallest >= 3) labelled.add(tallest);

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartHead}>
        <span className={styles.chartTitle}>{title}</span>
        {total && <span className={styles.chartTotal}>{total}</span>}
      </figcaption>
      <div className={styles.plot}>
        <div className={styles.gridline} style={{ top: 18 }} aria-hidden="true">
          <span className={styles.gridLabel}>{format(top)}</span>
        </div>
        {points.map((point, index) => {
          const height = top > 0 ? Math.min(100, (point.value / top) * 100) : 0;
          const text = `${shortDay(point.day)}: ${format(point.value)}${point.note ? ` · ${point.note}` : ""}`;
          return (
            <div key={point.day} className={styles.col} tabIndex={0} aria-label={text}>
              <span className={point.value > 0 ? styles.bar : styles.barZero} style={{ height: `${height}%` }}>
                {labelled.has(index) && (
                  <span className={styles.endLabel} aria-hidden="true">
                    {format(point.value)}
                  </span>
                )}
              </span>
              <span className={styles.tip} aria-hidden="true">
                {text}
              </span>
            </div>
          );
        })}
      </div>
      <div className={styles.axis} aria-hidden="true">
        <span>{points[0] ? shortDay(points[0].day) : ""}</span>
        <span>{points.length > 1 && points[last] ? shortDay(points[last].day) : ""}</span>
      </div>
      <details className={styles.tableToggle}>
        <summary>Show as table</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className={styles.num}>
                {title}
              </th>
              {points.some((point) => point.note) && <th scope="col">Also</th>}
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.day}>
                <td>{shortDay(point.day)}</td>
                <td className={styles.num}>{format(point.value)}</td>
                {points.some((p) => p.note) && <td>{point.note ?? ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/* --- Horizontal bars ------------------------------------------------------------------------- */

export interface BarRow {
  key: string;
  label: string;
  value: number;
  valueText: string;
}

/** Rows of one measure as bars in the one chart colour, the value at the bar's end. */
export function HBars({ rows, label }: { rows: BarRow[]; label: string }) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  return (
    <ul className={styles.hbars} aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className={styles.hbarRow}>
          <span className={styles.hbarLabel} title={row.label}>
            {row.label}
          </span>
          <span className={styles.hbarTrack} aria-hidden="true">
            <span className={styles.hbarFill} style={{ width: max > 0 ? `${Math.max(1, (row.value / max) * 100)}%` : "0%" }} />
          </span>
          <span className={styles.hbarValue}>{row.valueText}</span>
        </li>
      ))}
    </ul>
  );
}

/* --- Counts ---------------------------------------------------------------------------------- */

export function Counts({ title, rows, total }: { title: string; rows: { label: string; n: number }[]; total: number }) {
  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>{title}</h3>
      {rows.length === 0 ? (
        <p className={styles.muted}>—</p>
      ) : (
        <ul className={styles.counts}>
          {rows.map((row) => (
            <li key={row.label} className={styles.countRow}>
              <span className={styles.countLabel} title={row.label}>
                {row.label}
              </span>
              <span className={styles.countValue}>
                {formatCount(row.n)}
                <span className={styles.share}>{total > 0 ? `${Math.round((row.n / total) * 100)}%` : ""}</span>
              </span>
              <span className={styles.countBar} aria-hidden="true">
                <span style={{ width: total > 0 ? `${(row.n / total) * 100}%` : "0%" }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SectionHead({ id, title, hint }: { id: string; title: string; hint?: ReactNode }) {
  return (
    <div className={styles.sectionHead}>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}
