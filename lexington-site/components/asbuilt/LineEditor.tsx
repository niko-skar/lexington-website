"use client";

import { Fragment, useState } from "react";

import { mm } from "@/lib/asbuilt/format";
import {
  boxStatus,
  chainLines,
  chainOf,
  deviationOf,
  isFixedColumn,
  sizeOf,
  tapeGaps,
  type TapeItem,
} from "@/lib/asbuilt/geometry";
import { pathOf } from "@/lib/asbuilt/paths";
import type { Axis, Change, Floor, Selection, Tolerance } from "@/lib/asbuilt/types";

import s from "./AsBuilt.module.css";
import { MM_INPUT } from "./keys";
import { clearFromCentres, itemName, parseMm, StatusChip, type SaveFn } from "./Sheet";

interface Props {
  floor: Floor;
  tol: Tolerance;
  busy: boolean;
  onSave: SaveFn;
  onSelect: (sel: Selection) => void;
}

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;

/**
 * Taping a whole line in one go (Niko, 15 Oct 2026): walk along a row (or down a
 * line) and type each column's size and the gap to the next one, face to face,
 * then save the line. Empty boxes stay "not measured".
 */
export function MeasureLines({ floor, tol, busy, onSave, onSelect }: Props) {
  const rows = chainLines(floor, "x");
  const lines = chainLines(floor, "y");
  const [pick, setPick] = useState<{ axis: Axis; id: string }>({ axis: "x", id: rows[0] ?? "" });
  const ok = (pick.axis === "x" ? rows : lines).includes(pick.id);
  const chosen = ok
    ? pick
    : rows.length
      ? { axis: "x" as Axis, id: rows[0] }
      : { axis: "y" as Axis, id: lines[0] ?? "" };

  if (!rows.length && !lines.length) return null;
  const chips = (axis: Axis, ids: string[]) =>
    ids.map((id) => {
      const on = chosen.axis === axis && chosen.id === id;
      return (
        <button
          key={`${axis}${id}`}
          type="button"
          className={on ? s.pickOn : s.pick}
          aria-pressed={on}
          onClick={() => setPick({ axis, id })}
        >
          {id}
        </button>
      );
    });

  return (
    <section className={s.group}>
      <h3 className={s.groupTitle}>
        Tape a line <small>each column&rsquo;s size and the gap to the next one</small>
      </h3>
      {rows.length > 0 && (
        <div className={s.linePicker}>
          <span>Along grid</span>
          {chips("x", rows)}
        </div>
      )}
      {lines.length > 0 && (
        <div className={s.linePicker}>
          <span>Down grid</span>
          {chips("y", lines)}
        </div>
      )}
      {chosen.id && (
        <LineEditor
          key={`${floor.key}:${chosen.axis}:${chosen.id}:${floor._rev ?? ""}`}
          floor={floor}
          axis={chosen.axis}
          lineId={chosen.id}
          tol={tol}
          busy={busy}
          onSave={onSave}
          onSelect={onSelect}
        />
      )}
    </section>
  );
}

function LineEditor({
  floor,
  axis,
  lineId,
  tol,
  busy,
  onSave,
  onSelect,
}: {
  floor: Floor;
  axis: Axis;
  lineId: string;
  tol: Tolerance;
  busy: boolean;
  onSave: SaveFn;
  onSelect: (sel: Selection) => void;
}) {
  const chain = chainOf(floor, axis, lineId);
  const gaps = tapeGaps(floor, axis, lineId);
  const field = axis === "x" ? "gx" : "gy";
  const gapAfter = (it: TapeItem) => gaps.find((g) => g.prev.el._key === it.el._key);
  const where = axis === "x" ? `Along grid ${lineId}` : `Down grid ${lineId}`;

  const recordedGaps = (centres: boolean) =>
    Object.fromEntries(
      gaps.map((g) => [g.next.el._key, g.typed !== null ? mm(centres ? (g.typedCc ?? g.typed) : g.typed) : ""]),
    );
  const [centres, setCentres] = useState(false);
  const [sizes, setSizes] = useState<Record<string, { w: string; h: string }>>(() =>
    Object.fromEntries(
      chain.map((it) => [it.el._key, { w: has(it.el.w) ? mm(it.el.w) : "", h: has(it.el.h) ? mm(it.el.h) : "" }]),
    ),
  );
  const [gapTexts, setGapTexts] = useState<Record<string, string>>(() => recordedGaps(false));
  const [error, setError] = useState("");

  const switchMode = (next: boolean) => {
    setCentres(next);
    setGapTexts(recordedGaps(next));
  };

  // Fills only the empty boxes with the drawing, to save typing where it matches.
  const fillBlanks = () => {
    setSizes((all) =>
      Object.fromEntries(
        chain.map((it) => {
          const cur = all[it.el._key] ?? { w: "", h: "" };
          const sz = sizeOf(floor, it.el);
          return [it.el._key, { w: cur.w || (sz ? mm(sz.dw) : ""), h: cur.h || (sz ? mm(sz.dh) : "") }];
        }),
      ),
    );
    setGapTexts((all) =>
      Object.fromEntries(gaps.map((g) => [g.next.el._key, all[g.next.el._key] || mm(centres ? g.ccDesign : g.design)])),
    );
  };

  const save = async () => {
    const changes: Change[] = [];
    const touched = new Set<string>();
    let nSizes = 0;
    let nGaps = 0;
    const sizeAfter = (it: TapeItem, which: "w" | "h") => {
      const typed = parseMm(sizes[it.el._key]?.[which] ?? "");
      const sz = sizeOf(floor, it.el);
      return typed ?? (sz ? (which === "w" ? sz.w : sz.h) : 0);
    };
    for (const it of chain) {
      for (const which of ["w", "h"] as const) {
        const text = sizes[it.el._key]?.[which] ?? "";
        const v = parseMm(text);
        const stored = it.el[which];
        const label = which === "w" ? "width" : "depth";
        if (text.trim() && v === null) return setError(`${itemName(it)}: the ${label} isn't a number.`);
        if (v !== null && v < 50)
          return setError(`${itemName(it)}: a ${label} of ${v} mm can't be right (31 cm is 310).`);
        if (v !== null && (!has(stored) || Math.abs(v - stored) >= 0.05)) {
          changes.push({ path: pathOf(it.list, it.el._key, which), value: v });
          touched.add(`${it.list}:${it.el._key}`);
          nSizes += 1;
        } else if (v === null && has(stored)) {
          changes.push({ path: pathOf(it.list, it.el._key, which), value: null });
          touched.add(`${it.list}:${it.el._key}`);
          nSizes += 1;
        }
      }
    }
    for (const g of gaps) {
      const text = gapTexts[g.next.el._key] ?? "";
      let v = parseMm(text);
      const stored = g.next.el[field];
      if (text.trim() && v === null) return setError(`The gap before ${itemName(g.next)} isn't a number.`);
      if (v !== null && centres) {
        const k = axis === "x" ? "w" : "h";
        v = clearFromCentres(v, sizeAfter(g.prev, k), sizeAfter(g.next, k));
      }
      if (v !== null && v < 0) return setError(`The gap before ${itemName(g.next)} comes out below 0: check it.`);
      if (v !== null && (!has(stored) || Math.abs(v - stored) >= 0.05)) {
        changes.push({ path: pathOf(g.next.list, g.next.el._key, field), value: v });
        touched.add(`${g.next.list}:${g.next.el._key}`);
        nGaps += 1;
      } else if (v === null && has(stored)) {
        changes.push({ path: pathOf(g.next.list, g.next.el._key, field), value: null });
        touched.add(`${g.next.list}:${g.next.el._key}`);
        nGaps += 1;
      }
    }
    if (!changes.length) return setError("Nothing new to save on this line.");
    setError("");
    const now = new Date().toISOString();
    for (const t of touched) {
      const [list, key] = t.split(":") as ["columns" | "cores", string];
      changes.push({ path: pathOf(list, key, "at"), value: now });
    }
    const bits = [
      nGaps ? `${nGaps} ${nGaps === 1 ? "gap" : "gaps"}` : "",
      nSizes ? `${nSizes} ${nSizes === 1 ? "size" : "sizes"}` : "",
    ];
    await onSave(changes, `${where}: ${bits.filter(Boolean).join(" and ")} taped`);
  };

  const arrow = axis === "x" ? "↔" : "↕";

  return (
    <div className={s.lineEditor} data-tape-scope>
      <div className={s.row} style={{ justifyContent: "space-between" }}>
        <span className={s.side} role="group" aria-label="Gaps measured as">
          <button
            type="button"
            className={!centres ? s.sideOn : s.sideBtn}
            aria-pressed={!centres}
            onClick={() => switchMode(false)}
          >
            Face to face
          </button>
          <button
            type="button"
            className={centres ? s.sideOn : s.sideBtn}
            aria-pressed={centres}
            onClick={() => switchMode(true)}
          >
            Centre to centre
          </button>
        </span>
        <span className={s.hint}>mm · grey = the drawing</span>
      </div>

      <ol className={s.lineList}>
        {chain.map((it) => {
          const sz = sizeOf(floor, it.el);
          const g = gapAfter(it);
          const cur = sizes[it.el._key] ?? { w: "", h: "" };
          const dev = deviationOf(floor, it.el);
          const sizeInput = (which: "w" | "h", label: string) => (
            <input
              className={
                cur[which].trim() && sz && parseMm(cur[which]) !== (which === "w" ? sz.dw : sz.dh)
                  ? s.numChanged
                  : s.num
              }
              {...MM_INPUT}
              aria-label={`${itemName(it)} ${label}`}
              placeholder={sz ? mm(which === "w" ? sz.dw : sz.dh) : ""}
              value={cur[which]}
              onChange={(e) => setSizes((all) => ({ ...all, [it.el._key]: { ...cur, [which]: e.target.value } }))}
              onFocus={(e) => e.target.select()}
            />
          );
          return (
            <Fragment key={it.el._key}>
              <li className={s.lineItem}>
                <button
                  type="button"
                  className={s.lineName}
                  onClick={() => onSelect({ kind: "box", list: it.list, key: it.el._key })}
                >
                  {itemName(it)}
                </button>
                {isFixedColumn(floor, it.el) ? (
                  <span className={s.fixedChip}>Fixed point</span>
                ) : (
                  <StatusChip status={boxStatus(floor, it.el, tol)} worst={dev?.worst ?? null} />
                )}
                <div className={s.lineSizes}>
                  <span className={s.lineSizeLabel}>Size</span>
                  {sizeInput("w", "width")}
                  <span aria-hidden="true">×</span>
                  {sizeInput("h", "depth")}
                </div>
              </li>
              {g && (
                <li className={s.lineGap}>
                  <span className={s.lineArrow} aria-hidden="true">
                    {arrow}
                  </span>
                  <span>
                    Gap to {itemName(g.next)}
                    <small>
                      drawing {mm(centres ? g.ccDesign : g.design)}
                      {g.off !== null && Math.abs(g.off) > tol.ok && (
                        <b className={Math.abs(g.off) > tol.warn ? s.offClash : s.offWarn}>
                          {" "}
                          · {mm(Math.abs(g.off))} mm out
                        </b>
                      )}
                    </small>
                  </span>
                  <input
                    className={
                      (gapTexts[g.next.el._key] ?? "").trim() &&
                      parseMm(gapTexts[g.next.el._key]) !== (centres ? g.ccDesign : g.design)
                        ? s.numChanged
                        : s.num
                    }
                    {...MM_INPUT}
                    aria-label={`Gap from ${itemName(g.prev)} to ${itemName(g.next)}`}
                    placeholder={mm(centres ? g.cc : g.actual)}
                    value={gapTexts[g.next.el._key] ?? ""}
                    onChange={(e) => setGapTexts((all) => ({ ...all, [g.next.el._key]: e.target.value }))}
                    onFocus={(e) => e.target.select()}
                  />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>

      {error && <p className={s.error}>{error}</p>}
      <div className={s.lineActions}>
        <button type="button" className={s.btnPrimary} disabled={busy} onClick={save}>
          Save this line
        </button>
        <button type="button" className={s.btn} disabled={busy} onClick={fillBlanks}>
          Fill empty boxes with the drawing
        </button>
      </div>
      <p className={s.hint}>
        Width is across the page, depth is down it. Every figure is kept as you type it: the grid lines stay straight,
        measured from the fixed point, and a gap that doesn&rsquo;t fit the others shows how far out it is.
      </p>
    </div>
  );
}
