"use client";

import { useState } from "react";

import {
  boxKindWord,
  boxTitle,
  gridRef,
  KIND_LABEL,
  mm,
  moveText,
  offsetText,
  signedMm,
  when,
} from "@/lib/asbuilt/format";
import {
  boxOf,
  boxStatus,
  chainLineOf,
  chainOf,
  clashesOf,
  deviationOf,
  edgeDeviation,
  edgeFigures,
  edgePos,
  edgeReaches,
  edgeSegment,
  findBox,
  gapFit,
  gapsAround,
  gapsOf,
  gridFit,
  isFixedColumn,
  itemFigures,
  linePos,
  openingNeighbours,
  gridLines,
  isMeasured,
  resolveFloor,
  shiftsForGap,
  sizeOf,
  slabCorners,
  statusFor,
  tapeGaps,
  tapeListOf,
  type FigureCheck,
  type FigureFit,
  type Status,
  type TapeEl,
  type TapeItem,
  type TapeList,
} from "@/lib/asbuilt/geometry";
import { pathOf } from "@/lib/asbuilt/paths";
import type {
  Axis,
  BoxEl,
  BoxList,
  Change,
  ColumnEl,
  CoreFaces,
  EdgeFigure,
  Faces,
  Floor,
  OpeningEl,
  OpeningKind,
  Selection,
  SlabEdge,
  Tolerance,
} from "@/lib/asbuilt/types";

import s from "./AsBuilt.module.css";
import { MM_INPUT } from "./keys";

export type SaveFn = (changes: Change[], text: string, el?: string) => Promise<boolean>;

interface SheetProps {
  floor: Floor;
  selection: Selection;
  tol: Tolerance;
  busy: boolean;
  onClose: () => void;
  onSave: SaveFn;
}

const STATUS_CLASS: Record<Status, string> = {
  none: s.statusNone,
  ok: s.statusOk,
  warn: s.statusWarn,
  off: s.statusOff,
  new: s.statusNew,
};

export function statusLabel(status: Status, worst: number | null, long = false): string {
  if (status === "none") return "Not measured yet";
  if (status === "new") return "Added on site";
  if (status === "ok") return worst ? `Within ${Math.max(1, Math.round(worst))} mm` : "Same as the drawing";
  return `${Math.round(worst ?? 0)} mm off${long ? " the drawing" : ""}`;
}

export function StatusChip({ status, worst, long = false }: { status: Status; worst: number | null; long?: boolean }) {
  return <span className={STATUS_CLASS[status]}>{statusLabel(status, worst, long)}</span>;
}

const nowIso = () => new Date().toISOString();
const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;

/** A number typed by hand: "1,250" or " 300 " both work. */
export function parseMm(text: string): number | null {
  const t = text.replace(/[,\s]/g, "");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
}

/** "C1 at D/3", or a lift core's name. */
export function itemName(it: TapeItem): string {
  return it.list === "columns" ? `${(it.el as ColumnEl).name} at ${gridRef(it.el)}` : it.el.name;
}

/** "D/3", or a lift core's name. */
export function itemRef(it: TapeItem): string {
  return it.list === "columns" ? gridRef(it.el) : it.el.name;
}

/** A centre-to-centre distance as the clear gap that is stored (face to face). */
export function clearFromCentres(cc: number, sizeA: number, sizeB: number): number {
  return Math.round((cc - sizeA / 2 - sizeB / 2) * 10) / 10;
}

export function Sheet({ floor, selection, tol, busy, onClose, onSave }: SheetProps) {
  let body: React.ReactNode = null;
  let kind = "";
  let title = "";
  let chip: React.ReactNode = null;

  if (selection.kind === "box") {
    const el = findBox(floor, selection.list, selection.key);
    if (el) {
      kind = boxKindWord(selection.list, el);
      title = boxTitle(selection.list, el);
      const dev = deviationOf(floor, el);
      chip =
        "removed" in el && el.removed ? (
          <span className={s.statusNone}>Marked not built</span>
        ) : (
          <StatusChip status={boxStatus(floor, el, tol)} worst={dev?.worst ?? null} long />
        );
      body = (
        <BoxBody
          key={`${floor.key}:${el._key}:${floor._rev ?? ""}:${JSON.stringify([el.actual ?? null, "w" in el ? el.w : null, "h" in el ? el.h : null, "gx" in el ? el.gx : null, "gy" in el ? el.gy : null, "edges" in el ? (el.edges ?? null) : null])}`}
          floor={floor}
          list={selection.list}
          el={el}
          tol={tol}
          busy={busy}
          onSave={onSave}
          onClose={onClose}
        />
      );
    }
  } else if (selection.kind === "edge") {
    const edge = floor.slab?.edges.find((e) => e._key === selection.key);
    if (edge) {
      const via = selection.via ? findBox(floor, selection.via.list, selection.via.key) : undefined;
      kind = via ? `Slab edge, from ${boxTitle(selection.via!.list, via)}` : "Slab edge";
      const at = edgePos(floor, edge, "actual");
      const line = linePos(floor, edge.axis, edge.ref, "actual");
      title = offsetText(edge.axis, at !== null && line !== null ? Math.round((at - line) * 10) / 10 : edge.design, edge.ref);
      const dev = edgeDeviation(floor, edge);
      chip = (
        <StatusChip
          status={dev === null ? "none" : statusFor(Math.abs(dev), tol)}
          worst={dev === null ? null : Math.abs(dev)}
        />
      );
      body = (
        <EdgeBody
          key={`${floor.key}:${edge._key}:${selection.via?.key ?? ""}:${floor._rev ?? ""}`}
          floor={floor}
          edgeKey={edge._key}
          via={selection.via}
          tol={tol}
          busy={busy}
          onSave={onSave}
        />
      );
    }
  } else if (selection.kind === "gap") {
    const gap = gapsOf(floor, selection.axis).find((g) => g.to.id === selection.to);
    if (gap) {
      kind = "Grid spacing";
      title = `Grid ${gap.from.id} to ${gap.to.id}`;
      const diff = Math.abs(gap.typed - gap.design);
      chip = <StatusChip status={gap.measured ? statusFor(diff, tol) : "none"} worst={gap.measured ? diff : null} long />;
      body = (
        <GapBody
          key={`${floor.key}:${selection.axis}:${gap.to.id}:${floor._rev ?? ""}`}
          floor={floor}
          axis={selection.axis}
          toId={gap.to.id}
          tol={tol}
          busy={busy}
          onSave={onSave}
        />
      );
    }
  } else {
    const next = findBox(floor, selection.list, selection.key) as TapeEl | undefined;
    const lineId = next ? chainLineOf(floor, selection.axis, { list: selection.list, el: next }) : "";
    const gap = next
      ? tapeGaps(floor, selection.axis, lineId).find((g) => g.next.el._key === selection.key)
      : undefined;
    if (gap) {
      const between = gap.prev.list === "cores" || gap.next.list === "cores" ? "Column to lift core" : "Between columns";
      kind = selection.axis === "x" ? `${between}, along grid ${lineId}` : `${between}, down grid ${lineId}`;
      title = `${itemRef(gap.prev)} to ${itemRef(gap.next)}`;
      const diff = Math.abs((gap.typed ?? gap.actual) - gap.design);
      chip = <StatusChip status={gap.measured ? statusFor(diff, tol) : "none"} worst={gap.measured ? diff : null} long />;
      body = (
        <ColGapBody
          key={`${floor.key}:${selection.axis}:${selection.key}:${floor._rev ?? ""}`}
          floor={floor}
          axis={selection.axis}
          list={selection.list}
          nextKey={selection.key}
          tol={tol}
          busy={busy}
          onSave={onSave}
        />
      );
    }
  }

  return (
    <aside className={s.panel} aria-label={title || "Details"}>
      <div className={s.panelHead}>
        <div className={s.panelTitle}>
          <div className={s.panelKind}>{kind || "Not found"}</div>
          <div className={s.panelName}>{title || "This item isn't on this floor"}</div>
          {chip && <div style={{ marginTop: 6 }}>{chip}</div>}
        </div>
        <button type="button" className={s.close} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className={s.panelBody}>
        {body}
        <ItemHistory floor={floor} selection={selection} />
      </div>
    </aside>
  );
}

// ---- a box: column, wall, lift core, opening -----------------------------------------

interface FaceState {
  text: string;
  neg: boolean;
}

const FACE_ROWS: { f: keyof Faces; label: string; axis: Axis }[] = [
  { f: "l", label: "Left face", axis: "x" },
  { f: "r", label: "Right face", axis: "x" },
  { f: "t", label: "Top face", axis: "y" },
  { f: "b", label: "Bottom face", axis: "y" },
];

function initialFaces(current: Faces, design: Faces | null): Record<keyof Faces, FaceState> {
  const out = {} as Record<keyof Faces, FaceState>;
  for (const { f } of FACE_ROWS) {
    const v = current[f];
    const fallbackNeg = (design?.[f] ?? (f === "l" || f === "t" ? -1 : 1)) < 0;
    out[f] = { text: mm(Math.abs(v)), neg: v === 0 ? fallbackNeg : v < 0 };
  }
  return out;
}

function BoxBody({
  floor,
  list,
  el,
  tol,
  busy,
  onSave,
  onClose,
}: {
  floor: Floor;
  list: BoxList;
  el: BoxEl;
  tol: Tolerance;
  busy: boolean;
  onSave: SaveFn;
  onClose: () => void;
}) {
  const tape = tapeListOf(el);
  const opening = list === "openings" ? (el as OpeningEl) : null;
  const design = el.design;
  const isCore = list === "cores";

  return (
    <>
      {design && (
        <p className={s.fact}>
          <span className={s.factStrong}>Drawing:</span> {mm(design.r - design.l)} × {mm(design.b - design.t)},{" "}
          {offsetText("x", design.l, el.x)} to {offsetText("x", design.r, el.x)}; {offsetText("y", design.t, el.y)} to{" "}
          {offsetText("y", design.b, el.y)}.{isCore && ` Walls ${mm((design as CoreFaces).wall)} thick.`}
          {(el as ColumnEl).ends && " It stops at the slab above."}
        </p>
      )}
      {!design && <p className={s.fact}>Added on site: not on the drawings.</p>}
      {isMeasured(el) && el.at && <p className={s.fact}>Last measured {when(el.at)}.</p>}

      {tape && isFixedColumn(floor, el) && (
        <p className={s.fixedNote}>
          <b>Fixed point.</b> Everything on this floor is measured from this column: it stays where the drawing has it,
          and every grid line runs straight from it.
        </p>
      )}
      {tape && !isFixedColumn(floor, el) && <LinesText floor={floor} el={el as TapeEl} />}
      {tape && <TapeBlock floor={floor} list={tape} el={el as TapeEl} tol={tol} busy={busy} onSave={onSave} />}
      {tape && itemFigures(floor, el as TapeEl).length > 0 && (
        <FigureRows
          floor={floor}
          figures={itemFigures(floor, el as TapeEl)}
          tol={tol}
          busy={busy}
          onSave={onSave}
          title="To the slab edge"
          label={(f) => `Edge by ${edgeSpan(floor, f.edge)}`}
        />
      )}

      {opening?.removed ? (
        <div className={s.row}>
          <span className={s.fact}>Marked as not built (or filled in).</span>
          <button
            type="button"
            className={s.btn}
            disabled={busy}
            onClick={() =>
              onSave(
                [{ path: pathOf("openings", el._key, "removed"), value: null }],
                `${boxTitle(list, el)}: put back (it is there)`,
                el._key,
              )
            }
          >
            It is there
          </button>
        </div>
      ) : opening ? (
        <>
          <OpeningSizeBlock floor={floor} el={opening} busy={busy} onSave={onSave} />
          <details className={s.more}>
            <summary>Position from the grid lines (string lines)</summary>
            <FacesBlock floor={floor} list={list} el={el} busy={busy} onSave={onSave} compact />
          </details>
        </>
      ) : tape ? (
        <details className={s.more}>
          <summary>Position from the grid lines (string lines)</summary>
          <p className={s.hint} style={{ margin: "6px 0 10px" }}>
            Only needed where you tape a column from the string lines, for example the first one on a line. The gaps
            above place the rest.
          </p>
          <FacesBlock floor={floor} list={list} el={el} busy={busy} onSave={onSave} compact />
        </details>
      ) : (
        <FacesBlock floor={floor} list={list} el={el} busy={busy} onSave={onSave} />
      )}

      {opening && <OpeningExtras floor={floor} el={opening} busy={busy} onSave={onSave} onClose={onClose} />}

      <NoteBlock list={list} el={el} busy={busy} onSave={onSave} />
    </>
  );
}

// ---- taped on site: the size, and the gaps to the columns either side --------------------

const TAPE_SIDES: { axis: Axis; side: "before" | "after"; label: string }[] = [
  { axis: "x", side: "before", label: "Left" },
  { axis: "x", side: "after", label: "Right" },
  { axis: "y", side: "before", label: "Above" },
  { axis: "y", side: "after", label: "Below" },
];

function TapeBlock({
  floor,
  list,
  el,
  tol,
  busy,
  onSave,
}: {
  floor: Floor;
  list: TapeList;
  el: TapeEl;
  tol: Tolerance;
  busy: boolean;
  onSave: SaveFn;
}) {
  const isCore = list === "cores";
  const size = sizeOf(floor, el);
  const around = gapsAround(floor, el);
  const gapAt = (axis: Axis, side: "before" | "after") => around.find((a) => a.axis === axis)?.[side];
  // Always what was typed, never the plan's figure: saving again must not change a figure.
  const recorded = (axis: Axis, side: "before" | "after", centres: boolean) => {
    const g = gapAt(axis, side);
    return g && g.typed !== null ? mm(centres ? (g.typedCc ?? g.typed) : g.typed) : "";
  };
  const gapTexts = (centres: boolean) =>
    Object.fromEntries(TAPE_SIDES.map(({ axis, side }) => [`${axis}${side}`, recorded(axis, side, centres)]));

  const [centres, setCentres] = useState(false);
  const [w, setW] = useState(has(el.w) ? mm(el.w) : "");
  const [h, setH] = useState(has(el.h) ? mm(el.h) : "");
  const [wall, setWall] = useState(isCore ? mm(((el.actual ?? el.design) as CoreFaces).wall) : "");
  const [gaps, setGaps] = useState<Record<string, string>>(() => gapTexts(false));
  const [error, setError] = useState("");
  if (!size) return null;
  const title = boxTitle(list, el);

  const switchMode = (next: boolean) => {
    setCentres(next);
    setGaps(gapTexts(next));
  };

  // This column's sizes after the save, for turning centre-to-centre into clear gaps.
  const myW = parseMm(w) ?? size.w;
  const myH = parseMm(h) ?? size.h;

  const build = (): { changes: Change[]; parts: string[] } | string => {
    const changes: Change[] = [];
    const parts: string[] = [];
    const sizes = [
      ["w", w, el.w, "width"],
      ["h", h, el.h, "depth"],
    ] as const;
    for (const [field, text, stored, label] of sizes) {
      const v = parseMm(text);
      if (text.trim() && v === null) return `The ${label} isn't a number.`;
      if (v !== null && v < 50) return `A ${label} of ${v} mm can't be right. Sizes are in mm: 31 cm is 310.`;
      if (v !== null && (!has(stored) || Math.abs(v - stored) >= 0.05)) {
        changes.push({ path: pathOf(list, el._key, field), value: v });
        parts.push(`${label} ${mm(v)}`);
      } else if (v === null && has(stored)) {
        changes.push({ path: pathOf(list, el._key, field), value: null });
        parts.push(`${label} cleared`);
      }
    }
    if (isCore) {
      const v = parseMm(wall);
      const cur = (el.actual ?? el.design) as CoreFaces;
      if (wall.trim() && (v === null || v < 50)) return "The wall thickness doesn't look right.";
      if (v !== null && Math.abs(v - cur.wall) >= 0.05) {
        changes.push({ path: pathOf(list, el._key, "actual"), value: { ...cur, wall: v } });
        parts.push(`walls ${mm(v)}`);
      }
    }
    for (const { axis, side } of TAPE_SIDES) {
      const g = gapAt(axis, side);
      if (!g) continue;
      const other = side === "before" ? g.prev : g.next;
      // The gap belongs to the later of the two.
      const holder: TapeItem = side === "before" ? { list, el } : g.next;
      const field = axis === "x" ? "gx" : "gy";
      const stored = holder.el[field];
      const text = gaps[`${axis}${side}`] ?? "";
      let v = parseMm(text);
      if (text.trim() && v === null) return `The gap to ${itemName(other)} isn't a number.`;
      if (v !== null && centres) {
        const os = sizeOf(floor, other.el);
        v = clearFromCentres(v, axis === "x" ? myW : myH, os ? (axis === "x" ? os.w : os.h) : 0);
      }
      if (v !== null && v < 0) return `The gap to ${itemName(other)} comes out below 0: check the number.`;
      if (v !== null && (!has(stored) || Math.abs(v - stored) >= 0.05)) {
        changes.push({ path: pathOf(holder.list, holder.el._key, field), value: v });
        parts.push(`gap to ${itemRef(other)} ${mm(v)}`);
      } else if (v === null && has(stored)) {
        changes.push({ path: pathOf(holder.list, holder.el._key, field), value: null });
        parts.push(`gap to ${itemRef(other)} cleared`);
      }
    }
    return { changes, parts };
  };

  const save = async () => {
    const built = build();
    if (typeof built === "string") {
      setError(built);
      return;
    }
    if (!built.changes.length) {
      setError("Nothing new to save: type a size or a gap first.");
      return;
    }
    setError("");
    built.changes.push({ path: pathOf(list, el._key, "at"), value: nowIso() });
    await onSave(built.changes, `${title}: ${built.parts.join(", ")}`, el._key);
  };

  const asDrawn = async () => {
    const changes: Change[] = [
      { path: pathOf(list, el._key, "w"), value: size.dw },
      { path: pathOf(list, el._key, "h"), value: size.dh },
    ];
    for (const axis of ["x", "y"] as const) {
      const g = gapAt(axis, "before");
      if (g) changes.push({ path: pathOf(list, el._key, axis === "x" ? "gx" : "gy"), value: g.design });
    }
    changes.push({ path: pathOf(list, el._key, "at"), value: nowIso() });
    await onSave(changes, `${title}: checked, size and gaps as drawn`, el._key);
  };

  const clear = async () => {
    const fields = ["w", "h", "gx", "gy", "actual", "at"] as const;
    await onSave(
      fields.map((f) => ({ path: pathOf(list, el._key, f), value: null })),
      `${title}: measurements cleared`,
      el._key,
    );
  };

  const shaft = isCore ? (parseMm(wall) ?? (el.design as CoreFaces).wall) : 0;
  const sizeField = (
    id: string,
    label: string,
    sub: string,
    value: string,
    set: (v: string) => void,
    drawn: number,
  ) => (
    <label className={s.tapeField} htmlFor={id}>
      <span>
        {label} <small>{sub}</small>
      </span>
      <input
        id={id}
        className={value.trim() && parseMm(value) !== drawn ? s.numChanged : s.num}
        {...MM_INPUT}
        placeholder={mm(drawn)}
        value={value}
        onChange={(e) => set(e.target.value)}
        onFocus={(e) => e.target.select()}
      />
    </label>
  );

  return (
    <div className={s.tape} data-tape-scope>
      <div className={s.blockTitle}>Size, mm</div>
      <div className={s.tapeGrid}>
        {sizeField("tape-w", "Width", "across", w, setW, size.dw)}
        {sizeField("tape-h", "Depth", "down the page", h, setH, size.dh)}
        {isCore && sizeField("tape-wall", "Walls", "thick", wall, setWall, (el.design as CoreFaces).wall)}
      </div>
      <p className={s.hint}>
        Drawing {mm(size.dw)} × {mm(size.dh)}. Leave a box empty if it isn&rsquo;t measured yet.
        {isCore && ` Lift shaft inside ${mm(myW - 2 * shaft)} × ${mm(myH - 2 * shaft)}.`}
      </p>

      <div className={s.blockTitle} style={{ marginTop: 14 }}>
        Gaps to the next columns, mm
      </div>
      <span className={s.side} role="group" aria-label="Measured as">
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
      <div className={s.gapList}>
        {TAPE_SIDES.map(({ axis, side, label }) => {
          const g = gapAt(axis, side);
          if (!g) return null;
          const other = side === "before" ? g.prev : g.next;
          const now = centres ? g.cc : g.actual;
          const drawn = centres ? g.ccDesign : g.design;
          const key = `${axis}${side}`;
          const out = g.off !== null && Math.abs(g.off) > tol.ok ? Math.abs(g.off) : null;
          return (
            <label key={key} className={s.gapRow} htmlFor={`gap-${key}`}>
              <span>
                <b>{label}</b> · {itemName(other)}
                <small>
                  drawing {mm(drawn)}
                  {Math.round(now) !== Math.round(drawn) ? ` · plan ${mm(now)}` : ""}
                  {out !== null && (
                    <b className={out > tol.warn ? s.offClash : s.offWarn}> · {mm(out)} mm out</b>
                  )}
                </small>
              </span>
              <input
                id={`gap-${key}`}
                className={(gaps[key] ?? "").trim() && parseMm(gaps[key]) !== drawn ? s.numChanged : s.num}
                {...MM_INPUT}
                placeholder={mm(now)}
                value={gaps[key] ?? ""}
                onChange={(e) => setGaps((all) => ({ ...all, [key]: e.target.value }))}
                onFocus={(e) => e.target.select()}
              />
            </label>
          );
        })}
        {!TAPE_SIDES.some(({ axis, side }) => gapAt(axis, side)) && (
          <p className={s.hint}>Nothing else stands on this column&rsquo;s grid lines.</p>
        )}
      </div>
      {error && <p className={s.error}>{error}</p>}
      <div className={s.row} style={{ marginTop: 12 }}>
        <button type="button" className={s.btnPrimary} disabled={busy} onClick={save}>
          Save measurements
        </button>
        <button type="button" className={s.btnGood} disabled={busy} onClick={asDrawn}>
          Same as drawing
        </button>
        {isMeasured(el) && (
          <button type="button" className={s.btnQuiet} disabled={busy} onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <p className={s.hint} style={{ marginTop: 8 }}>
        Every figure is kept as you type it. The grid lines stay straight from the fixed point; a gap that doesn&rsquo;t
        fit your other figures shows how far out it is, and never moves the other columns.
      </p>
    </div>
  );
}

// ---- the gap between two columns ----------------------------------------------------------

function ColGapBody({
  floor,
  axis,
  list,
  nextKey,
  tol,
  busy,
  onSave,
}: {
  floor: Floor;
  axis: Axis;
  list: TapeList;
  nextKey: string;
  tol: Tolerance;
  busy: boolean;
  onSave: SaveFn;
}) {
  const next = findBox(floor, list, nextKey) as TapeEl | undefined;
  const lineId = next ? chainLineOf(floor, axis, { list, el: next }) : "";
  const gap = next ? tapeGaps(floor, axis, lineId).find((g) => g.next.el._key === nextKey) : undefined;
  const fit = gapFit(floor, axis, nextKey);
  const [centres, setCentres] = useState(false);
  const [text, setText] = useState(gap && gap.typed !== null ? mm(gap.typed) : "");
  if (!gap || !next) return null;
  const field = axis === "x" ? "gx" : "gy";
  const ps = sizeOf(floor, gap.prev.el);
  const ns = sizeOf(floor, gap.next.el);
  const along = (sz: ReturnType<typeof sizeOf>) => (sz ? (axis === "x" ? sz.w : sz.h) : 0);
  const typed = parseMm(text);
  const value = typed === null ? null : centres ? clearFromCentres(typed, along(ps), along(ns)) : typed;
  const line = axis === "x" ? `along grid ${lineId}` : `down grid ${lineId}`;

  const switchMode = (c: boolean) => {
    setCentres(c);
    setText(gap.typed !== null ? mm(c ? (gap.typedCc ?? gap.typed) : gap.typed) : "");
  };

  const save = async () => {
    if (value === null || value < 0) return;
    await onSave(
      [
        { path: pathOf(gap.next.list, nextKey, field), value },
        { path: pathOf(gap.next.list, nextKey, "at"), value: nowIso() },
      ],
      `Gap ${itemRef(gap.prev)} to ${itemRef(gap.next)} ${line}: ${mm(value)} face to face${
        Math.round(value) !== Math.round(gap.design) ? ` (drawing ${mm(gap.design)})` : ""
      }`,
      nextKey,
    );
  };

  return (
    <>
      <p className={s.fact}>
        From <span className={s.factStrong}>{itemName(gap.prev)}</span> to{" "}
        <span className={s.factStrong}>{itemName(gap.next)}</span>, {line}. Drawing: {mm(gap.design)} face to face (
        {mm(gap.ccDesign)} centre to centre).
        {gap.typed !== null && ` Taped: ${mm(gap.typed)} face to face.`}
        {gap.typed !== null && Math.round(gap.actual) !== Math.round(gap.typed) && ` On the plan: ${mm(gap.actual)}.`}
      </p>
      {fit && <FitExplain floor={floor} fit={fit} tol={tol} />}
      <span className={s.side} role="group" aria-label="Measured as">
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
      <label className={s.gapRow} htmlFor="colgap-v">
        <span>
          <b>Gap</b>
          <small>{centres ? "centre to centre" : "face to face"}, mm</small>
        </span>
        <input
          id="colgap-v"
          className={s.num}
          {...MM_INPUT}
          placeholder={mm(centres ? gap.cc : gap.actual)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
      </label>
      {value !== null && Math.round(value) !== Math.round(gap.design) && (
        <div className={s.derived}>
          {signedMm(value - gap.design)} mm against the drawing ({mm(value)} face to face)
        </div>
      )}
      <div className={s.row}>
        <button type="button" className={s.btnPrimary} disabled={busy || value === null || value < 0} onClick={save}>
          Save
        </button>
        {gap.measured && (
          <button
            type="button"
            className={s.btnQuiet}
            disabled={busy}
            onClick={() =>
              onSave(
                [{ path: pathOf(gap.next.list, nextKey, field), value: null }],
                `Gap ${itemRef(gap.prev)} to ${itemRef(gap.next)} ${line}: cleared`,
                nextKey,
              )
            }
          >
            Clear
          </button>
        )}
      </div>
      <p className={s.hint}>
        Kept exactly as you type it. It helps place the grid lines with your other figures; if it doesn&rsquo;t fit them,
        it shows how far out it is. It never moves a run of columns.
      </p>
    </>
  );
}

// ---- position from the grid lines (faces) ---------------------------------------------------

function FacesBlock({
  floor,
  list,
  el,
  busy,
  onSave,
  compact = false,
}: {
  floor: Floor;
  list: BoxList;
  el: BoxEl;
  busy: boolean;
  onSave: SaveFn;
  /** Inside a column's panel: just the position, no "same as drawing" or "clear" of its own. */
  compact?: boolean;
}) {
  const isCore = list === "cores";
  const design = el.design;
  const current = boxOf(floor, el, "actual");
  const lx = linePos(floor, "x", el.x, "actual");
  const ly = linePos(floor, "y", el.y, "actual");
  const start: Faces | null =
    current && lx !== null && ly !== null
      ? { l: current.x0 - lx, r: current.x1 - lx, t: current.y0 - ly, b: current.y1 - ly }
      : (el.actual ?? el.design);
  const [faces, setFaces] = useState(() => initialFaces(start ?? { l: -500, r: 500, t: -500, b: 500 }, design));
  const [error, setError] = useState("");
  const title = boxTitle(list, el);

  const parsed: Faces | null = (() => {
    const out = {} as Faces;
    for (const { f } of FACE_ROWS) {
      const v = parseMm(faces[f].text);
      if (v === null) return null;
      out[f] = faces[f].neg ? -v : v;
    }
    return out;
  })();
  const valid = parsed !== null && parsed.r - parsed.l >= 20 && parsed.b - parsed.t >= 20;

  let preview: React.ReactNode = null;
  if (parsed && valid) {
    const parts = [`Size ${mm(parsed.r - parsed.l)} × ${mm(parsed.b - parsed.t)}`];
    if (design) {
      const dx = (parsed.l + parsed.r) / 2 - (design.l + design.r) / 2;
      const dy = (parsed.t + parsed.b) / 2 - (design.t + design.b) / 2;
      parts.push(`centre ${moveText(dx, dy)}`);
    }
    preview = <div className={s.derived}>{parts.join(" · ")}</div>;
  } else if (parsed) {
    preview = (
      <div className={s.error}>A face is on the wrong side of the other: check left/right and above/below.</div>
    );
  }

  const save = async () => {
    if (!parsed || !valid) {
      setError("Fill in all four faces.");
      return;
    }
    setError("");
    const wall = isCore ? ((el.actual ?? el.design) as CoreFaces).wall : undefined;
    const value = isCore ? { ...parsed, wall } : parsed;
    const changes: Change[] = [{ path: pathOf(list, el._key, "actual"), value }];
    // Faces from the string lines give the size too; the gaps stay as typed (compared, never cleared).
    if (compact) {
      for (const f of ["w", "h"] as const) {
        if (has((el as TapeEl)[f])) changes.push({ path: pathOf(list, el._key, f), value: null });
      }
    }
    changes.push({ path: pathOf(list, el._key, "at"), value: nowIso() });
    let text = `${title}: from the grid lines ${mm(parsed.r - parsed.l)} × ${mm(parsed.b - parsed.t)}`;
    if (design) {
      const dx = (parsed.l + parsed.r) / 2 - (design.l + design.r) / 2;
      const dy = (parsed.t + parsed.b) / 2 - (design.t + design.b) / 2;
      text += `, ${moveText(dx, dy)}`;
    }
    await onSave(changes, text, el._key);
  };

  const asDrawn = async () => {
    if (!design) return;
    await onSave(
      [
        { path: pathOf(list, el._key, "actual"), value: design },
        { path: pathOf(list, el._key, "at"), value: nowIso() },
      ],
      `${title}: checked, same as the drawing`,
      el._key,
    );
  };

  const clear = async () => {
    await onSave(
      [
        { path: pathOf(list, el._key, "actual"), value: null },
        { path: pathOf(list, el._key, "at"), value: null },
      ],
      `${title}: measurement cleared`,
      el._key,
    );
  };

  return (
    <div>
      {!compact && <div className={s.blockTitle}>As built, from the grid lines (mm)</div>}
      <div className={s.faceGrid}>
        {FACE_ROWS.map(({ f, label, axis }) => {
          const line = axis === "x" ? el.x : el.y;
          const v = parseMm(faces[f].text);
          const signed = v === null ? null : faces[f].neg ? -v : v;
          const differs = design && signed !== null && Math.round(signed) !== Math.round(design[f]);
          const words = axis === "x" ? ["left", "right"] : ["above", "below"];
          return (
            <div key={f} className={s.faceRow}>
              <label className={s.faceLabel} htmlFor={`face-${f}`}>
                {label}
                <small>from grid {line}</small>
              </label>
              <input
                id={`face-${f}`}
                className={differs ? s.numChanged : s.num}
                {...MM_INPUT}
                value={faces[f].text}
                onChange={(e) => setFaces((all) => ({ ...all, [f]: { ...all[f], text: e.target.value } }))}
                onFocus={(e) => e.target.select()}
                aria-describedby={design ? `face-${f}-drawing` : undefined}
              />
              <span className={s.side} role="group" aria-label={`${label}: which side of grid ${line}`}>
                {words.map((word, i) => (
                  <button
                    key={word}
                    type="button"
                    className={faces[f].neg === (i === 0) ? s.sideOn : s.sideBtn}
                    aria-pressed={faces[f].neg === (i === 0)}
                    onClick={() => setFaces((all) => ({ ...all, [f]: { ...all[f], neg: i === 0 } }))}
                  >
                    {word}
                  </button>
                ))}
              </span>
              {design && (
                <span id={`face-${f}-drawing`} className={s.hint} style={{ gridColumn: "2 / 4", marginTop: -4 }}>
                  drawing: {offsetText(axis, design[f], line)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10 }}>{preview}</div>
      {error && <p className={s.error}>{error}</p>}
      <div className={s.row} style={{ marginTop: 12 }}>
        <button type="button" className={compact ? s.btn : s.btnPrimary} disabled={busy || !valid} onClick={save}>
          {compact ? "Save position" : "Save measurements"}
        </button>
        {!compact && design && (
          <button type="button" className={s.btnGood} disabled={busy} onClick={asDrawn}>
            Same as drawing
          </button>
        )}
        {!compact && isMeasured(el) && design && (
          <button type="button" className={s.btnQuiet} disabled={busy} onClick={clear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ---- a void as it is: its size, and how far it is from the columns around it ------------------

function OpeningSizeBlock({ floor, el, busy, onSave }: { floor: Floor; el: OpeningEl; busy: boolean; onSave: SaveFn }) {
  const cur = (el.actual ?? el.design) as Faces | null;
  const neighbours = openingNeighbours(floor, el);
  const [w, setW] = useState(cur ? mm(cur.r - cur.l) : "");
  const [h, setH] = useState(cur ? mm(cur.b - cur.t) : "");
  const [dist, setDist] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  if (!cur) return null;
  const name = el.name;
  const SIDE: Record<string, string> = { left: "Left", right: "Right", up: "Above", down: "Below" };

  const save = async () => {
    const wv = parseMm(w);
    const hv = parseMm(h);
    if (wv === null || hv === null || wv < 20 || hv < 20) return setError("Type the width and depth in mm.");
    // Distances to the columns move the void; the size grows from its top-left corner.
    let dx = 0;
    let dy = 0;
    const moves: string[] = [];
    for (const n of neighbours) {
      const t = (dist[n.side] ?? "").trim();
      if (!t) continue;
      const v = parseMm(t);
      if (v === null || v < 0) return setError(`The distance to ${itemName(n.item)} doesn't look right.`);
      if (Math.abs(v - n.distance) < 0.5) continue;
      if (n.side === "left") dx = v - n.distance;
      if (n.side === "up") dy = v - n.distance;
      // To the right / below: the far face is set, so the void moves the other way.
      if (n.side === "right") dx = n.distance - v - (wv - (cur.r - cur.l));
      if (n.side === "down") dy = n.distance - v - (hv - (cur.b - cur.t));
      moves.push(`${mm(v)} from ${itemRef(n.item)}`);
    }
    const next: Faces = { l: cur.l + dx, t: cur.t + dy, r: cur.l + dx + wv, b: cur.t + dy + hv };
    const same = next.l === cur.l && next.r === cur.r && next.t === cur.t && next.b === cur.b;
    if (same) return setError("Nothing new to save.");
    setError("");
    const bits = [`${mm(wv)} × ${mm(hv)}`, ...moves];
    await onSave(
      [
        { path: pathOf("openings", el._key, "actual"), value: next },
        { path: pathOf("openings", el._key, "at"), value: new Date().toISOString() },
      ],
      `${name}: ${bits.join(", ")}`,
      el._key,
    );
  };

  return (
    <div className={s.tape} data-tape-scope>
      <div className={s.blockTitle}>Size, mm</div>
      <div className={s.tapeGrid}>
        <label className={s.tapeField} htmlFor="void-w">
          <span>
            Width <small>across</small>
          </span>
          <input
            id="void-w"
            className={s.num}
            {...MM_INPUT}
            value={w}
            onChange={(e) => setW(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <label className={s.tapeField} htmlFor="void-h">
          <span>
            Depth <small>down the page</small>
          </span>
          <input
            id="void-h"
            className={s.num}
            {...MM_INPUT}
            value={h}
            onChange={(e) => setH(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </label>
      </div>
      {el.design && (
        <p className={s.hint}>
          Drawing {mm(el.design.r - el.design.l)} × {mm(el.design.b - el.design.t)}.
        </p>
      )}
      {neighbours.length > 0 && (
        <>
          <div className={s.blockTitle} style={{ marginTop: 10 }}>
            Distance to the columns around it, mm
          </div>
          <div className={s.gapList}>
            {neighbours.map((n) => (
              <label key={n.side} className={s.gapRow} htmlFor={`void-n-${n.side}`}>
                <span>
                  <b>{SIDE[n.side]}</b> · {itemName(n.item)}
                  <small>now {mm(n.distance)}, face to face</small>
                </span>
                <input
                  id={`void-n-${n.side}`}
                  className={s.num}
                  {...MM_INPUT}
                  placeholder={mm(n.distance)}
                  value={dist[n.side] ?? ""}
                  onChange={(e) => setDist((all) => ({ ...all, [n.side]: e.target.value }))}
                  onFocus={(e) => e.target.select()}
                />
              </label>
            ))}
          </div>
        </>
      )}
      {error && <p className={s.error}>{error}</p>}
      <div className={s.row} style={{ marginTop: 10 }}>
        <button type="button" className={s.btnPrimary} disabled={busy} onClick={save}>
          Save
        </button>
      </div>
      <p className={s.hint}>
        Or on the plan: drag the void to move it, drag a corner to resize it. A new size keeps its top-left corner.
      </p>
    </div>
  );
}

// ---- openings: name, kind, not built / delete ------------------------------------------

const KINDS: OpeningKind[] = ["void", "duct", "stair", "pool"];

function OpeningExtras({
  floor,
  el,
  busy,
  onSave,
  onClose,
}: {
  floor: Floor;
  el: OpeningEl;
  busy: boolean;
  onSave: SaveFn;
  onClose: () => void;
}) {
  const [name, setName] = useState(el.name);
  const [kind, setKind] = useState<OpeningKind>(el.kind);
  const changed = name.trim() !== el.name || kind !== el.kind;

  const saveName = async () => {
    const changes: Change[] = [];
    if (name.trim() && name.trim() !== el.name)
      changes.push({ path: pathOf("openings", el._key, "name"), value: name.trim() });
    if (kind !== el.kind) changes.push({ path: pathOf("openings", el._key, "kind"), value: kind });
    if (changes.length)
      await onSave(changes, `${el.name}: now "${name.trim() || el.name}" (${KIND_LABEL[kind].toLowerCase()})`, el._key);
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${el.name}" from the ${floor.name}? You can undo it from the history.`)) return;
    const ok = await onSave([{ path: pathOf("openings", el._key), value: null }], `${el.name}: deleted`, el._key);
    if (ok) onClose();
  };

  return (
    <div>
      <div className={s.blockTitle}>Name and kind</div>
      <div className={s.faceGrid}>
        <input
          className={s.text}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          aria-label="Name"
        />
        <select
          className={s.select}
          value={kind}
          onChange={(e) => setKind(e.target.value as OpeningKind)}
          aria-label="Kind"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className={s.row} style={{ marginTop: 10 }}>
        {changed && (
          <button type="button" className={s.btn} disabled={busy} onClick={saveName}>
            Save name
          </button>
        )}
        {el.added ? (
          <button type="button" className={s.btnDanger} disabled={busy} onClick={remove}>
            Delete this opening
          </button>
        ) : (
          !el.removed && (
            <button
              type="button"
              className={s.btnDanger}
              disabled={busy}
              onClick={() =>
                onSave(
                  [{ path: pathOf("openings", el._key, "removed"), value: true }],
                  `${el.name}: marked as not built`,
                  el._key,
                )
              }
            >
              Not built / filled in
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ---- notes ------------------------------------------------------------------------------

function NoteBlock({ list, el, busy, onSave }: { list: BoxList; el: BoxEl; busy: boolean; onSave: SaveFn }) {
  const [note, setNote] = useState(el.note ?? "");
  const changed = note.trim() !== (el.note ?? "");
  return (
    <div>
      <label className={s.blockTitle} htmlFor="el-note" style={{ display: "block" }}>
        Note
      </label>
      <textarea
        id="el-note"
        className={s.text}
        value={note}
        maxLength={500}
        placeholder="e.g. kicker poured 12 Oct, measured by Eric"
        onChange={(e) => setNote(e.target.value)}
      />
      {changed && (
        <div className={s.row} style={{ marginTop: 8 }}>
          <button
            type="button"
            className={s.btn}
            disabled={busy}
            onClick={() =>
              onSave(
                [{ path: pathOf(list, el._key, "note"), value: note.trim() || null }],
                `${boxTitle(list, el)}: note ${note.trim() ? "saved" : "removed"}`,
                el._key,
              )
            }
          >
            Save note
          </button>
        </div>
      )}
    </div>
  );
}

// ---- a slab edge ------------------------------------------------------------------------

function nearestLine(floor: Floor, axis: Axis, v: number): string {
  const lines = gridLines(floor, axis);
  let best = lines[0];
  for (const l of lines)
    if (Math.abs(l.design + (l.shift ?? 0) - v) < Math.abs(best.design + (best.shift ?? 0) - v)) best = l;
  return best?.id ?? "";
}

function EdgeBody({
  floor,
  edgeKey,
  via,
  tol,
  busy,
  onSave,
}: {
  floor: Floor;
  edgeKey: string;
  via?: { list: TapeList; key: string };
  tol: Tolerance;
  busy: boolean;
  onSave: SaveFn;
}) {
  const edge = floor.slab?.edges.find((e) => e._key === edgeKey);
  const current = edge ? (edge.actual ?? edge.design) : 0;
  const reach = via
    ? edgeReaches(floor).find((r) => r.edge._key === edgeKey && r.item.list === via.list && r.item.el._key === via.key)
    : undefined;
  const viaEl = via ? (findBox(floor, via.list, via.key) as TapeEl | undefined) : undefined;
  const viaItem: TapeItem | null = via && viaEl ? { list: via.list, el: viaEl } : null;
  const mine = viaEl?.edges?.find((f) => f.edge === edgeKey);
  const [text, setText] = useState(mm(Math.abs(current)));
  const [neg, setNeg] = useState(current === 0 ? (edge?.design ?? 0) < 0 : current < 0);
  const [fromText, setFromText] = useState(mine ? mm(mine.d) : "");
  if (!edge || !floor.slab) return null;

  const corners = slabCorners(floor, "actual");
  const i = floor.slab.edges.findIndex((e) => e._key === edgeKey);
  const seg = corners ? edgeSegment(corners, i) : null;
  const along: Axis = edge.axis === "x" ? "y" : "x";
  const span = seg
    ? `${nearestLine(floor, along, seg[0][along === "x" ? 0 : 1])} to ${nearestLine(floor, along, seg[1][along === "x" ? 0 : 1])}`
    : "";
  const words = edge.axis === "x" ? ["left", "right"] : ["above", "below"];
  const typed = parseMm(text);
  const value = typed === null ? null : neg ? -typed : typed;

  const save = async () => {
    if (value === null) return;
    await onSave(
      [
        { path: pathOf("slab.edges", edge._key, "actual"), value },
        { path: pathOf("slab.edges", edge._key, "at"), value: nowIso() },
      ],
      `Slab edge by ${span}: ${offsetText(edge.axis, value, edge.ref)}${Math.round(value) !== Math.round(edge.design) ? ` (drawing ${mm(Math.abs(edge.design))})` : ""}`,
      edge._key,
    );
  };

  // Taped from a column face: kept on the column exactly as typed. It never moves the edge
  // under another column's figure; if the figures don't agree, that shows as a clash.
  const fromTyped = parseMm(fromText);
  const unchanged = mine !== undefined && fromTyped !== null && Math.abs(mine.d - fromTyped) < 0.05;
  const saveFromColumn = async () => {
    if (!viaItem || fromTyped === null) return;
    await onSave(
      [{ path: pathOf(viaItem.list, viaItem.el._key, "edges"), value: withFigure(viaItem.el, edge._key, fromTyped) }],
      `${itemRef(viaItem)} to the slab edge by ${span}: ${mm(fromTyped)}${mine ? ` (was ${mm(mine.d)})` : ""}`,
      edge._key,
    );
  };
  const figures = edgeFigures(floor, edge._key);

  return (
    <>
      {viaItem && (
        <div className={s.tape}>
          <div className={s.blockTitle}>From the column face to the edge, mm</div>
          <label className={s.gapRow} htmlFor="edge-from">
            <span>
              <b>{viaItem.list === "columns" ? boxTitle("columns", viaItem.el) : viaItem.el.name}</b>
              <small>
                drawing {reach?.design == null ? "?" : mm(reach.design)}
                {mine ? ` · you measured ${mm(mine.d)}` : reach ? ` · now ${mm(reach.distance)}` : ""}
              </small>
            </span>
            <input
              id="edge-from"
              className={s.num}
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              placeholder={reach ? mm(reach.distance) : ""}
              value={fromText}
              onChange={(e) => setFromText(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <div className={s.row}>
            <button
              type="button"
              className={s.btnPrimary}
              disabled={busy || fromTyped === null || unchanged}
              onClick={saveFromColumn}
            >
              Save
            </button>
          </div>
          <p className={s.hint}>
            Kept exactly as you type it. If it doesn&rsquo;t fit your other figures, it is shown in red; nothing
            else moves.
          </p>
        </div>
      )}
      {figures.length > 0 && (
        <FigureRows
          floor={floor}
          figures={figures}
          tol={tol}
          busy={busy}
          onSave={onSave}
          title="Measured to this edge"
          label={(f) => itemRef(f.item)}
        />
      )}
      <p className={s.fact}>
        <span className={s.factStrong}>Drawing:</span> {offsetText(edge.axis, edge.design, edge.ref)}
        {span && `, running ${span}`}.
      </p>
      {edge.note && (
        <p className={s.fact} style={{ color: "var(--brass-text)" }}>
          Check: {edge.note}.
        </p>
      )}
      {edge.at && <p className={s.fact}>Measured {when(edge.at)}.</p>}
      <div>
        <div className={s.blockTitle}>As built (mm from grid {edge.ref})</div>
        <div className={s.faceRow}>
          <label className={s.faceLabel} htmlFor="edge-v">
            Edge
            <small>from grid {edge.ref}</small>
          </label>
          <input
            id="edge-v"
            className={s.num}
            {...MM_INPUT}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
          <span className={s.side} role="group" aria-label={`Which side of grid ${edge.ref}`}>
            {words.map((word, i2) => (
              <button
                key={word}
                type="button"
                className={neg === (i2 === 0) ? s.sideOn : s.sideBtn}
                aria-pressed={neg === (i2 === 0)}
                onClick={() => setNeg(i2 === 0)}
              >
                {word}
              </button>
            ))}
          </span>
        </div>
        {value !== null && Math.round(value) !== Math.round(edge.design) && (
          <div className={s.derived} style={{ marginTop: 10 }}>
            {signedMm(Math.abs(value) - Math.abs(edge.design))} mm against the drawing
          </div>
        )}
        <div className={s.row} style={{ marginTop: 12 }}>
          <button type="button" className={s.btnPrimary} disabled={busy || value === null} onClick={save}>
            Save
          </button>
          <button
            type="button"
            className={s.btnGood}
            disabled={busy}
            onClick={() =>
              onSave(
                [
                  { path: pathOf("slab.edges", edge._key, "actual"), value: edge.design },
                  { path: pathOf("slab.edges", edge._key, "at"), value: nowIso() },
                ],
                `Slab edge by ${span}: checked, same as the drawing`,
                edge._key,
              )
            }
          >
            Same as drawing
          </button>
          {edge.actual !== null && edge.actual !== undefined && (
            <button
              type="button"
              className={s.btnQuiet}
              disabled={busy}
              onClick={() =>
                onSave(
                  [
                    { path: pathOf("slab.edges", edge._key, "actual"), value: null },
                    { path: pathOf("slab.edges", edge._key, "at"), value: null },
                  ],
                  `Slab edge by ${span}: measurement cleared`,
                  edge._key,
                )
              }
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ---- figures taped from a column to a slab edge ------------------------------------------------

/** "C to N": the grid lines a slab edge runs between, as built. */
export function edgeSpan(floor: Floor, edge: SlabEdge): string {
  const corners = slabCorners(floor, "actual");
  const i = floor.slab?.edges.findIndex((e) => e._key === edge._key) ?? -1;
  if (!corners || i < 0) return `grid ${edge.ref}`;
  const seg = edgeSegment(corners, i);
  const along: Axis = edge.axis === "x" ? "y" : "x";
  return `${nearestLine(floor, along, seg[0][along === "x" ? 0 : 1])} to ${nearestLine(floor, along, seg[1][along === "x" ? 0 : 1])}`;
}

const figureKey = () => `f${Math.random().toString(36).slice(2, 10)}`;

/** The column's figures with this edge's set to `d` (a new figure, or the old one corrected). */
function withFigure(el: TapeEl, edgeKey: string, d: number): EdgeFigure[] {
  return [...(el.edges ?? []).filter((f) => f.edge !== edgeKey), { _key: figureKey(), edge: edgeKey, d, at: nowIso() }];
}

function withoutFigure(el: TapeEl, edgeKey: string): EdgeFigure[] | null {
  const left = (el.edges ?? []).filter((f) => f.edge !== edgeKey);
  return left.length ? left : null;
}

/** Off by more than the tolerance: the figure doesn't fit the others. */
const clashing = (f: FigureCheck, tol: Tolerance) => Math.abs(f.off) > tol.ok;

export function fitStatus(off: number, tol: Tolerance): { text: string; className: string } {
  const a = Math.abs(off);
  if (a <= tol.ok) return { text: a < 0.5 ? "Fits" : `Fits (${mm(a)} mm)`, className: s.statusOk };
  return { text: `${mm(a)} mm out`, className: a <= tol.warn ? s.statusWarn : s.statusClash };
}

/** Every figure taped along an item's row or line: "Down grid K: K/3 to Lift 2 5380, Lift 2 depth 2500, ...". */
export function runText(floor: Floor, axis: Axis, it: TapeItem): string {
  const lineId = chainLineOf(floor, axis, it);
  const sizeWord = axis === "x" ? "width" : "depth";
  const parts: string[] = [];
  const chain = chainOf(floor, axis, lineId);
  chain.forEach((x, k) => {
    const gap = axis === "x" ? x.el.gx : x.el.gy;
    if (k > 0 && has(gap)) parts.push(`${itemRef(chain[k - 1])} to ${itemRef(x)} ${mm(gap)}`);
    const size = axis === "x" ? x.el.w : x.el.h;
    if (has(size)) parts.push(`${itemRef(x)} ${sizeWord} ${mm(size)}`);
  });
  const where = axis === "x" ? `Along grid ${lineId}` : `Down grid ${lineId}`;
  return parts.length ? `${where}: ${parts.join(", ")}` : `${where}: nothing taped yet`;
}

/** The two grid lines a gap runs between, e.g. "5>7" for a gap from row 5 to row 7. */
const spanOf = (f: FigureFit) =>
  f.prev && f.next ? (f.axis === "x" ? [f.prev.el.x, f.next.el.x] : [f.prev.el.y, f.next.el.y]).join(">") : "";

const fitWord = (f: FigureFit, tol: Tolerance) => (Math.abs(f.off) <= tol.ok ? "fits" : `${mm(Math.abs(f.off))} mm out`);

/** Why a figure doesn't fit the others, and what to tape again. */
function FitExplain({ floor, fit, tol }: { floor: Floor; fit: FigureFit; tol: Tolerance }) {
  const out = Math.abs(fit.off);
  if (out <= tol.ok) return null;
  const r = resolveFloor(floor);
  const from = r.fixed ? itemRef(r.fixed) : "the fixed point";
  let what = "";
  const checks: string[] = [];
  let others: string[] = [];
  if (fit.kind === "gap" && fit.prev && fit.next) {
    const word = fit.axis === "x" ? "width" : "depth";
    const size = (it: TapeItem) => {
      const v = fit.axis === "x" ? it.el.w : it.el.h;
      return has(v) ? mm(v) : "as drawn";
    };
    what = `${itemRef(fit.prev)} to ${itemRef(fit.next)}`;
    checks.push(`This gap (${mm(fit.typed)} face to face)`);
    checks.push(`The ${word} of ${itemRef(fit.prev)} (${size(fit.prev)}) and of ${itemRef(fit.next)} (${size(fit.next)})`);
    checks.push(`${itemRef(fit.prev)} and ${itemRef(fit.next)} from their string lines: one may stand off its line`);
    const span = spanOf(fit);
    others = r.fits
      .filter((f) => f !== fit && f.kind === "gap" && f.axis === fit.axis && spanOf(f) === span)
      .map((f) => `${itemRef(f.prev!)} to ${itemRef(f.next!)} ${mm(f.typed)} (${fitWord(f, tol)})`);
  } else if (fit.kind === "edge" && fit.item && fit.edge) {
    what = `${itemRef(fit.item)} to the slab edge`;
    checks.push(`This figure (${mm(fit.typed)})`);
    checks.push(`${itemRef(fit.item)} from its string line: it may stand off its line`);
    others = r.fits
      .filter((f) => f !== fit && (f.kind === "edge" || f.kind === "edgeGrid") && f.edge?._key === fit.edge!._key)
      .map((f) =>
        f.kind === "edge"
          ? `${itemRef(f.item!)} ${mm(f.typed)} (${fitWord(f, tol)})`
          : `from grid ${f.edge!.ref} ${mm(f.typed)} (${fitWord(f, tol)})`,
      );
  } else if (fit.kind === "edgeGrid" && fit.edge) {
    what = `the edge from grid ${fit.edge.ref}`;
    checks.push(`The edge from grid ${fit.edge.ref} (${mm(fit.typed)})`);
    others = r.fits
      .filter((f) => f.kind === "edge" && f.edge?._key === fit.edge!._key)
      .map((f) => `${itemRef(f.item!)} ${mm(f.typed)} (${fitWord(f, tol)})`);
  } else if (fit.kind === "grid" && fit.from && fit.to) {
    what = `grid ${fit.from.id} to ${fit.to.id}`;
    checks.push(`This spacing (${mm(fit.typed)})`);
    checks.push("The gaps between the columns on these two lines");
  }
  return (
    <div className={out > tol.warn ? s.clashNote : s.warnNote}>
      <p>
        <b>{mm(out)} mm out.</b> With every grid line straight from {from}, your other figures make {what}{" "}
        {mm(fit.fitted)}, not the {mm(fit.typed)} you taped. Nothing was moved for it. Tape again:
      </p>
      <ul className={s.clashList}>
        {checks.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {others.length > 0 && (
        <p className={s.othersLine}>
          {fit.kind === "gap" ? "The same two lines elsewhere: " : "Your other figures to this edge: "}
          {others.join("; ")}.
        </p>
      )}
    </div>
  );
}

/** Where a column's own grid lines came out, measured from the fixed point (when they moved). */
function LinesText({ floor, el }: { floor: Floor; el: TapeEl }) {
  const fixed = resolveFloor(floor).fixed;
  if (!fixed) return null;
  const parts: string[] = [];
  for (const axis of ["x", "y"] as const) {
    const id = axis === "x" ? el.x : el.y;
    const line = gridLines(floor, axis).find((g) => g.id === id);
    const at = linePos(floor, axis, id, "actual");
    if (!line || at === null) continue;
    const d = Math.round(at - line.design);
    if (Math.abs(d) < 1) continue;
    const dir = axis === "x" ? (d > 0 ? "right" : "left") : d > 0 ? "down" : "up";
    parts.push(`grid ${id} ${mm(Math.abs(d))} mm ${dir}`);
  }
  if (!parts.length) return null;
  return (
    <p className={s.fact}>
      Measured from {itemRef(fixed)}, its grid lines came out {parts.join(" and ")} of the drawing.
    </p>
  );
}

function FigureRows({
  floor,
  figures,
  tol,
  busy,
  onSave,
  title,
  label,
}: {
  floor: Floor;
  figures: FigureCheck[];
  tol: Tolerance;
  busy: boolean;
  onSave: SaveFn;
  title: string;
  label: (f: FigureCheck) => string;
}) {
  const remove = (f: FigureCheck) =>
    onSave(
      [{ path: pathOf(f.item.list, f.item.el._key, "edges"), value: withoutFigure(f.item.el, f.edge._key) }],
      `${itemRef(f.item)} to the slab edge by ${edgeSpan(floor, f.edge)}: ${mm(f.figure.d)} removed`,
      f.edge._key,
    );
  return (
    <div>
      <div className={s.blockTitle}>{title}</div>
      <ul className={s.figList}>
        {figures.map((f) => {
          const status = fitStatus(f.off, tol);
          return (
            <li key={f.figure._key} className={s.figRow}>
              <span className={s.figName}>
                {label(f)}
                {f.figure.at && <small>{when(f.figure.at)}</small>}
              </span>
              <b className={s.figValue}>{mm(f.figure.d)}</b>
              <span className={status.className}>{status.text}</span>
              <button
                type="button"
                className={s.figRemove}
                disabled={busy}
                aria-label={`Remove ${label(f)}: ${mm(f.figure.d)}`}
                onClick={() => void remove(f)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {figures
        .filter((f) => clashing(f, tol))
        .map((f) => {
          const fit = resolveFloor(floor).fits.find((x) => x.kind === "edge" && x.figure?._key === f.figure._key);
          return fit ? <FitExplain key={f.figure._key} floor={floor} fit={fit} tol={tol} /> : null;
        })}
    </div>
  );
}

/** Above the plan: every figure on this floor that is well out from the others, each a tap away. */
export function ClashNotice({
  floor,
  tol,
  onSelect,
}: {
  floor: Floor;
  tol: Tolerance;
  onSelect: (selection: Selection) => void;
}) {
  const clashes = clashesOf(floor, tol.warn);
  if (!clashes.length) return null;
  const pick = (c: FigureFit): Selection =>
    c.kind === "gap"
      ? { kind: "colgap", axis: c.axis, list: c.next!.list, key: c.next!.el._key }
      : c.kind === "edge"
        ? { kind: "edge", key: c.edge!._key, via: { list: c.item!.list, key: c.item!.el._key } }
        : c.kind === "edgeGrid"
          ? { kind: "edge", key: c.edge!._key }
          : { kind: "gap", axis: c.axis, to: c.to!.id };
  const label = (c: FigureFit) =>
    c.kind === "gap"
      ? `${itemRef(c.prev!)} to ${itemRef(c.next!)}`
      : c.kind === "edge"
        ? `${itemRef(c.item!)} to the edge`
        : c.kind === "edgeGrid"
          ? `Edge from grid ${c.edge!.ref}`
          : `Grid ${c.from!.id} to ${c.to!.id}`;
  return (
    <div className={s.clashBar} role="status">
      <span className={s.clashBarTitle}>
        {clashes.length === 1 ? "1 figure doesn’t fit the others" : `${clashes.length} figures don’t fit the others`}
      </span>
      {clashes.slice(0, 4).map((c, i) => (
        <button key={`${c.kind}${i}`} type="button" className={s.clashChip} onClick={() => onSelect(pick(c))}>
          {label(c)} {mm(c.typed)} · {mm(Math.abs(c.off))} mm out
        </button>
      ))}
      {clashes.length > 4 && <span className={s.hint}>and {clashes.length - 4} more</span>}
    </div>
  );
}

// ---- a grid spacing ---------------------------------------------------------------------

function GapBody({
  floor,
  axis,
  toId,
  tol,
  busy,
  onSave,
}: {
  floor: Floor;
  axis: Axis;
  toId: string;
  tol: Tolerance;
  busy: boolean;
  onSave: SaveFn;
}) {
  const gap = gapsOf(floor, axis).find((g) => g.to.id === toId);
  const fit = gridFit(floor, axis, toId);
  const [text, setText] = useState(gap ? mm(gap.measured ? gap.typed : gap.actual) : "");
  if (!gap) return null;
  const typed = parseMm(text);

  const apply = async (value: number, measured: boolean) => {
    const shifts = shiftsForGap(floor, axis, toId, value);
    const changes: Change[] = shifts.map((sh) => ({
      path: pathOf("grid", sh.key, "shift"),
      value: Math.round(sh.shift * 10) ? sh.shift : null,
    }));
    changes.push({ path: pathOf("grid", gap.to._key, "measured"), value: measured || null });
    const drawn = Math.round(value) !== Math.round(gap.design) ? ` (drawing ${mm(gap.design)})` : "";
    await onSave(
      changes,
      measured
        ? `Grid ${gap.from.id} to ${toId} measured ${mm(value)}${drawn}`
        : `Grid ${gap.from.id} to ${toId} back to the drawing`,
      `${axis}${toId}`,
    );
  };

  return (
    <>
      <p className={s.fact}>
        <span className={s.factStrong}>Drawing:</span> {mm(gap.design)}.{" "}
        {gap.measured && (
          <>
            <span className={s.factStrong}>Taped:</span> {mm(gap.typed)}.{" "}
          </>
        )}
        <span className={s.factStrong}>On the plan:</span> {mm(gap.actual)}
        {Math.round(gap.actual) !== Math.round(gap.design) ? ` (${signedMm(gap.actual - gap.design)})` : ""}.
      </p>
      {fit && <FitExplain floor={floor} fit={fit} tol={tol} />}
      <div className={s.faceRow}>
        <label className={s.faceLabel} htmlFor="gap-v">
          Spacing
          <small>
            {gap.from.id} to {toId}, mm
          </small>
        </label>
        <input
          id="gap-v"
          className={s.num}
          {...MM_INPUT}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <span />
      </div>
      <p className={s.hint}>
        Kept as you type it, with your other figures: the plan places the lines from all of them, measured from the
        fixed point. To record the gap between two columns, tap the number between them instead.
      </p>
      <div className={s.row}>
        <button
          type="button"
          className={s.btnPrimary}
          disabled={busy || typed === null || typed <= 0}
          onClick={() => typed !== null && apply(typed, true)}
        >
          Save
        </button>
        {(gap.measured || Math.round(gap.typed) !== Math.round(gap.design)) && (
          <button type="button" className={s.btnQuiet} disabled={busy} onClick={() => apply(gap.design, false)}>
            Back to the drawing
          </button>
        )}
      </div>
    </>
  );
}

// ---- this item's own history ------------------------------------------------------------

function ItemHistory({ floor, selection }: { floor: Floor; selection: Selection }) {
  const key = selection.kind === "gap" ? `${selection.axis}${selection.to}` : selection.key;
  const entries = (floor.log ?? [])
    .filter((l) => l.el === key)
    .slice(-8)
    .reverse();
  if (!entries.length) return null;
  return (
    <div>
      <div className={s.blockTitle}>History</div>
      <ul className={s.miniLog}>
        {entries.map((l) => (
          <li key={l._key}>
            <time dateTime={l.at}>{when(l.at)}</time>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
