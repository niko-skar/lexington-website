"use client";

import { useState } from "react";

import type { Condition, StoreItem, StoreTool } from "@/lib/store/shared";
import { errorText, send } from "./api";
import site from "./Site.module.css";
import { ConditionChips, UnitPicker } from "./StoreBits";
import styles from "./Todo.module.css";

// A material that's really a tool, or the other way round (Niko, 6 Nov 2026: "my ... new storekeeper keeps adding tools
// into materials and vice versa, can you put it in the change panel that I can turn it from a tool into a material or
// the otherway round?"): on the office's Change sheets, a button that opens what the other kind needs (how many; the
// state a tool is in, the unit a material is counted in) and moves it across (POST /api/store/switch,
// lib/store/switchKind.ts). The sheet's own buttons wait while it moves.

type Box = { disabled: boolean; onBusy: (busy: boolean) => void };

/** On a material's Change: "It's a tool, not a material". */
export function ToToolBox({ item, disabled, onBusy, onSwitched }: Box & { item: StoreItem; onSwitched: (tool: StoreTool) => void }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(String(Math.max(0, Math.round(item.level))));
  const [condition, setCondition] = useState<Condition>("good");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const move = async () => {
    setError("");
    const n = Number(count);
    if (count.trim() === "" || !Number.isInteger(n) || n < 0) return setError("Type how many we have (0 if none).");
    setSaving(true);
    onBusy(true);
    try {
      const { tool } = await send<{ tool: StoreTool }>("/api/store/switch", "POST", { from: "item", id: item.id, count: n, condition });
      onSwitched(tool);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
      onBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={site.switchKind} onClick={() => setOpen(true)} disabled={disabled}>
        It&rsquo;s a tool, not a material
      </button>
    );
  }
  return (
    <div className={site.switchBox}>
      <p className={styles.sheetNote}>
        It moves to the tools with its name and photo. What&rsquo;s recorded for it here (taken out, counted) doesn&rsquo;t come along; purchases of it stay in the
        expenses.
      </p>
      <label className={styles.label} htmlFor="store-switch-count">
        How many do we have?
      </label>
      <input
        id="store-switch-count"
        className={`${styles.input} ${site.countInput}`}
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        value={count}
        onChange={(e) => setCount(e.target.value)}
      />
      <ConditionChips value={condition} onChange={setCondition} />
      {error && <p className={styles.sheetError}>{error}</p>}
      <div className={site.switchButtons}>
        <button type="button" onClick={() => setOpen(false)} disabled={saving}>
          Not now
        </button>
        <button type="button" className={styles.sheetSave} onClick={() => void move()} disabled={saving || disabled}>
          {saving ? "Moving…" : "Move it to the tools"}
        </button>
      </div>
    </div>
  );
}

/** On a tool's Change: "It's a material, not a tool". Not while some are out with people. */
export function ToItemBox({ tool, outNow, disabled, onBusy, onSwitched }: Box & { tool: StoreTool; outNow: number; onSwitched: (item: StoreItem) => void }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(String(tool.count));
  const [unit, setUnit] = useState("pcs");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const move = async () => {
    setError("");
    const n = Number(count);
    if (count.trim() === "" || !(n >= 0)) return setError("Type how many there are now (0 if none).");
    setSaving(true);
    onBusy(true);
    try {
      const { item } = await send<{ item: StoreItem }>("/api/store/switch", "POST", { from: "tool", id: tool.id, count: n, unit: unit.trim() || "pcs" });
      onSwitched(item);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
      onBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={site.switchKind} onClick={() => setOpen(true)} disabled={disabled}>
        It&rsquo;s a material, not a tool
      </button>
    );
  }
  return (
    <div className={site.switchBox}>
      <p className={styles.sheetNote}>It moves to the materials with its name and photo. Its take-outs don&rsquo;t come along.</p>
      {outNow > 0 && (
        <p className={styles.sheetError}>
          {outNow === 1 ? "1 is" : `${outNow} are`} out now: take {outNow === 1 ? "it" : "them"} back first.
        </p>
      )}
      <label className={styles.label} htmlFor="tool-switch-count">
        How many are there now?
      </label>
      <input
        id="tool-switch-count"
        className={`${styles.input} ${site.countInput}`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={count}
        onChange={(e) => setCount(e.target.value)}
      />
      <span className={styles.label}>Counted in</span>
      <UnitPicker id="tool-switch-unit" value={unit} onChange={setUnit} />
      {error && <p className={styles.sheetError}>{error}</p>}
      <div className={site.switchButtons}>
        <button type="button" onClick={() => setOpen(false)} disabled={saving}>
          Not now
        </button>
        <button type="button" className={styles.sheetSave} onClick={() => void move()} disabled={saving || disabled || outNow > 0}>
          {saving ? "Moving…" : "Move it to the materials"}
        </button>
      </div>
    </div>
  );
}
