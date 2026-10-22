"use client";

import { useMemo, useState } from "react";

import { fmtQty } from "@/lib/store/shared";
import site from "./Site.module.css";
import styles from "./Todo.module.css";

// The quantity wheel from the old expense page: − and + either side of a scroll list
// (1–200, then by tens to 1,000, then by hundreds to 10,000), or type an exact number.
const STEPS: number[] = (() => {
  const values: number[] = [];
  for (let i = 1; i <= 200; i++) values.push(i);
  for (let i = 210; i <= 1000; i += 10) values.push(i);
  for (let i = 1100; i <= 10000; i += 100) values.push(i);
  return values;
})();

export function QtyPicker({ id, value, onChange, unit }: { id: string; value: number; onChange: (n: number) => void; unit?: string }) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const options = useMemo(() => (STEPS.includes(value) ? STEPS : [...STEPS, value].sort((a, b) => a - b)), [value]);

  const set = (n: number) => {
    const rounded = Math.round(n * 1000) / 1000;
    onChange(rounded > 0 ? rounded : 1);
  };

  return (
    <div className={site.qtyBox}>
      <div className={site.qty}>
        <button type="button" onClick={() => set(value > 1 ? Math.ceil(value - 1) : 1)} aria-label="One less">
          −
        </button>
        <select
          id={id}
          value={String(value)}
          onChange={(e) => {
            set(Number(e.target.value));
            setText("");
          }}
        >
          {options.map((n) => (
            <option key={n} value={String(n)}>
              {fmtQty(n)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => set(Math.floor(value) + 1)} aria-label="One more">
          +
        </button>
      </div>
      <div className={site.qtyRow}>
        {unit ? <span className={site.qtyUnit}>{unit}</span> : <span />}
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => {
            setTyping(!typing);
            setText(typing ? "" : String(value));
          }}
        >
          {typing ? "Use the wheel" : "Type a number"}
        </button>
      </div>
      {typing && (
        <input
          className={styles.input}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          aria-label="Exact quantity"
          placeholder="Exact quantity"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseFloat(e.target.value);
            if (n > 0) set(n);
          }}
        />
      )}
    </div>
  );
}
