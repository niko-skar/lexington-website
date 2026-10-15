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
  deviationOf,
  edgeDeviation,
  edgeSegment,
  findBox,
  gapsOf,
  gridLines,
  isMeasured,
  neighboursOf,
  shiftsForGap,
  slabCorners,
  statusFor,
  type Neighbour,
  type Status,
} from "@/lib/asbuilt/geometry";
import { pathOf } from "@/lib/asbuilt/paths";
import type {
  Axis,
  BoxEl,
  BoxList,
  Change,
  ColumnEl,
  CoreFaces,
  Faces,
  Floor,
  OpeningEl,
  OpeningKind,
  Selection,
  Tolerance,
} from "@/lib/asbuilt/types";

import s from "./AsBuilt.module.css";

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

export function statusLabel(status: Status, worst: number | null): string {
  if (status === "none") return "Not measured yet";
  if (status === "new") return "Added on site";
  if (status === "ok") return worst ? `Within ${Math.max(1, Math.round(worst))} mm` : "Same as the drawing";
  return `${Math.round(worst ?? 0)} mm off`;
}

export function StatusChip({ status, worst }: { status: Status; worst: number | null }) {
  return <span className={STATUS_CLASS[status]}>{statusLabel(status, worst)}</span>;
}

const nowIso = () => new Date().toISOString();

/** A number typed by hand: "1,250" or " 300 " both work. */
function parseMm(text: string): number | null {
  const t = text.replace(/[,\s]/g, "");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
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
          <StatusChip status={boxStatus(floor, el, tol)} worst={dev?.worst ?? null} />
        );
      body = (
        <BoxBody
          key={`${floor.key}:${el._key}:${floor._rev ?? ""}`}
          floor={floor}
          list={selection.list}
          el={el}
          busy={busy}
          onSave={onSave}
          onClose={onClose}
        />
      );
    }
  } else if (selection.kind === "edge") {
    const edge = floor.slab?.edges.find((e) => e._key === selection.key);
    if (edge) {
      kind = "Slab edge";
      title = offsetText(edge.axis, edge.actual ?? edge.design, edge.ref);
      const dev = edgeDeviation(floor, edge);
      chip = (
        <StatusChip
          status={dev === null ? "none" : statusFor(Math.abs(dev), tol)}
          worst={dev === null ? null : Math.abs(dev)}
        />
      );
      body = (
        <EdgeBody
          key={`${floor.key}:${edge._key}:${floor._rev ?? ""}`}
          floor={floor}
          edgeKey={edge._key}
          busy={busy}
          onSave={onSave}
        />
      );
    }
  } else {
    const gap = gapsOf(floor, selection.axis).find((g) => g.to.id === selection.to);
    if (gap) {
      kind = "Grid spacing";
      title = `Grid ${gap.from.id} to ${gap.to.id}`;
      const diff = Math.abs(gap.actual - gap.design);
      chip = <StatusChip status={gap.measured ? statusFor(diff, tol) : "none"} worst={gap.measured ? diff : null} />;
      body = (
        <GapBody
          key={`${floor.key}:${selection.axis}:${gap.to.id}:${floor._rev ?? ""}`}
          floor={floor}
          axis={selection.axis}
          toId={gap.to.id}
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
  busy,
  onSave,
  onClose,
}: {
  floor: Floor;
  list: BoxList;
  el: BoxEl;
  busy: boolean;
  onSave: SaveFn;
  onClose: () => void;
}) {
  const isCore = list === "cores";
  const design = el.design;
  const current = (el.actual ?? el.design) as Faces | CoreFaces | null;
  const [faces, setFaces] = useState(() => initialFaces(current ?? { l: -500, r: 500, t: -500, b: 500 }, design));
  const [wallText, setWallText] = useState(() => (isCore ? mm((current as CoreFaces).wall) : ""));
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
  const wall = isCore ? parseMm(wallText) : null;
  const valid =
    parsed !== null &&
    parsed.r - parsed.l >= 20 &&
    parsed.b - parsed.t >= 20 &&
    (!isCore || (wall !== null && wall > 0));

  // What the typed numbers would mean, before saving.
  let preview: React.ReactNode = null;
  if (parsed && valid) {
    const w = parsed.r - parsed.l;
    const h = parsed.b - parsed.t;
    const parts = [`Size ${mm(w)} × ${mm(h)}`];
    if (design) {
      const dw = w - (design.r - design.l);
      const dh = h - (design.b - design.t);
      if (Math.round(dw) || Math.round(dh))
        parts.push(`drawing ${mm(design.r - design.l)} × ${mm(design.b - design.t)}`);
      const dx = (parsed.l + parsed.r) / 2 - (design.l + design.r) / 2;
      const dy = (parsed.t + parsed.b) / 2 - (design.t + design.b) / 2;
      parts.push(`centre ${moveText(dx, dy)}`);
    }
    if (isCore && wall) parts.push(`lift shaft inside ${mm(w - 2 * wall)} × ${mm(h - 2 * wall)}`);
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
    const value = isCore ? { ...parsed, wall: wall as number } : parsed;
    const w = parsed.r - parsed.l;
    const h = parsed.b - parsed.t;
    let text = `${title}: measured ${mm(w)} × ${mm(h)}`;
    if (design) {
      const dx = (parsed.l + parsed.r) / 2 - (design.l + design.r) / 2;
      const dy = (parsed.t + parsed.b) / 2 - (design.t + design.b) / 2;
      text += `, ${moveText(dx, dy)}`;
    }
    await onSave(
      [
        { path: pathOf(list, el._key, "actual"), value },
        { path: pathOf(list, el._key, "at"), value: nowIso() },
      ],
      text,
      el._key,
    );
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

  const opening = list === "openings" ? (el as OpeningEl) : null;
  const designBox = design ? boxOf(floor, el, "design") : null;
  const facesSummary = (f: Faces) =>
    `${offsetText("x", f.l, el.x)} to ${offsetText("x", f.r, el.x)}; ${offsetText("y", f.t, el.y)} to ${offsetText("y", f.b, el.y)}`;

  return (
    <>
      {design && designBox && (
        <p className={s.fact}>
          <span className={s.factStrong}>Drawing:</span> {mm(design.r - design.l)} × {mm(design.b - design.t)}, faces{" "}
          {facesSummary(design)}.{isCore && ` Walls ${mm((design as CoreFaces).wall)} thick.`}
          {(el as ColumnEl).ends && " It stops at the slab above."}
        </p>
      )}
      {!design && <p className={s.fact}>Added on site: not on the drawings.</p>}
      {isMeasured(el) && el.at && <p className={s.fact}>Measured {when(el.at)}.</p>}

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
                `${title}: put back (it is there)`,
                el._key,
              )
            }
          >
            It is there
          </button>
        </div>
      ) : (
        <div>
          <div className={s.blockTitle}>As built, from the grid lines (mm)</div>
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
                    inputMode="decimal"
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
            {isCore && (
              <div className={s.faceRow}>
                <label className={s.faceLabel} htmlFor="face-wall">
                  Wall thickness
                </label>
                <input
                  id="face-wall"
                  className={s.num}
                  inputMode="decimal"
                  value={wallText}
                  onChange={(e) => setWallText(e.target.value)}
                  onFocus={(e) => e.target.select()}
                />
                <span />
              </div>
            )}
          </div>
          <div style={{ marginTop: 10 }}>{preview}</div>
          {error && <p className={s.error}>{error}</p>}
          <div className={s.row} style={{ marginTop: 12 }}>
            <button type="button" className={s.btnPrimary} disabled={busy || !valid} onClick={save}>
              Save measurements
            </button>
            {design && (
              <button type="button" className={s.btnGood} disabled={busy} onClick={asDrawn}>
                Same as drawing
              </button>
            )}
            {isMeasured(el) && design && (
              <button type="button" className={s.btnQuiet} disabled={busy} onClick={clear}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {list === "columns" && !opening && (
        <NeighboursBlock floor={floor} el={el as ColumnEl} busy={busy} onSave={onSave} />
      )}

      {opening && <OpeningExtras floor={floor} el={opening} busy={busy} onSave={onSave} onClose={onClose} />}

      <NoteBlock list={list} el={el} busy={busy} onSave={onSave} />
    </>
  );
}

// ---- distances to the next columns along the grid -------------------------------------

const SIDE_WORD: Record<Neighbour["side"], string> = {
  left: "To the left",
  right: "To the right",
  up: "Above (up the page)",
  down: "Below (down the page)",
};

function NeighboursBlock({ floor, el, busy, onSave }: { floor: Floor; el: ColumnEl; busy: boolean; onSave: SaveFn }) {
  const [mode, setMode] = useState<"gap" | "centre">("gap");
  const [texts, setTexts] = useState<Record<string, string>>({});
  const neighbours = neighboursOf(floor, el);
  const me = boxOf(floor, el, "actual");
  const meD = boxOf(floor, el, "design");
  if (!neighbours.length || !me || !meD) return null;

  const gapOf = (n: Neighbour, mode2: "actual" | "design") => {
    const a = mode2 === "actual" ? me : meD;
    const b = boxOf(floor, n.el, mode2);
    if (!b) return 0;
    if (n.side === "left") return a.x0 - b.x1;
    if (n.side === "right") return b.x0 - a.x1;
    if (n.side === "up") return a.y0 - b.y1;
    return b.y0 - a.y1;
  };

  const move = async (n: Neighbour) => {
    const typed = parseMm(texts[n.side] ?? "");
    if (typed === null) return;
    const now = mode === "gap" ? gapOf(n, "actual") : n.actual;
    const delta = typed - now;
    if (!Math.round(delta * 10)) return;
    // Lengthening the distance pushes this column away from that one.
    const dir = n.side === "left" || n.side === "up" ? 1 : -1;
    const cur = (el.actual ?? el.design) as Faces;
    const next: Faces =
      n.side === "left" || n.side === "right"
        ? { ...cur, l: cur.l + dir * delta, r: cur.r + dir * delta }
        : { ...cur, t: cur.t + dir * delta, b: cur.b + dir * delta };
    const how = mode === "gap" ? "clear gap" : "centre to centre";
    await onSave(
      [
        { path: pathOf("columns", el._key, "actual"), value: next },
        { path: pathOf("columns", el._key, "at"), value: nowIso() },
      ],
      `${boxTitle("columns", el)}: ${mm(typed)} ${how} from ${n.el.name} at ${gridRef(n.el)}`,
      el._key,
    );
    setTexts((t) => ({ ...t, [n.side]: "" }));
  };

  return (
    <div>
      <div className={s.blockTitle}>Distance to the next column</div>
      <div className={s.row} style={{ marginBottom: 8 }}>
        <span className={s.side} role="group" aria-label="Measure as">
          <button
            type="button"
            className={mode === "gap" ? s.sideOn : s.sideBtn}
            aria-pressed={mode === "gap"}
            onClick={() => setMode("gap")}
          >
            Clear gap
          </button>
          <button
            type="button"
            className={mode === "centre" ? s.sideOn : s.sideBtn}
            aria-pressed={mode === "centre"}
            onClick={() => setMode("centre")}
          >
            Centre to centre
          </button>
        </span>
      </div>
      <div className={s.neighbours}>
        {neighbours.map((n) => {
          const now = mode === "gap" ? gapOf(n, "actual") : n.actual;
          const drawn = mode === "gap" ? gapOf(n, "design") : n.design;
          return (
            <div key={n.side} className={s.neighbour}>
              <div>
                {SIDE_WORD[n.side]}: {n.el.name} at {gridRef(n.el)}
                <small>
                  now {mm(now)}
                  {Math.round(now) !== Math.round(drawn) ? ` · drawing ${mm(drawn)}` : " · as drawn"}
                </small>
              </div>
              <input
                className={s.num}
                inputMode="decimal"
                placeholder={mm(now)}
                value={texts[n.side] ?? ""}
                onChange={(e) => setTexts((t) => ({ ...t, [n.side]: e.target.value }))}
                aria-label={`Measured ${mode === "gap" ? "clear gap" : "centre to centre"} to ${n.el.name} at ${gridRef(n.el)}`}
              />
              <button
                type="button"
                className={`${s.btn} ${s.btnSmall}`}
                disabled={busy || parseMm(texts[n.side] ?? "") === null}
                onClick={() => move(n)}
              >
                Set
              </button>
            </div>
          );
        })}
      </div>
      <p className={s.hint}>Setting a distance moves this column, not the other one.</p>
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

function EdgeBody({ floor, edgeKey, busy, onSave }: { floor: Floor; edgeKey: string; busy: boolean; onSave: SaveFn }) {
  const edge = floor.slab?.edges.find((e) => e._key === edgeKey);
  const current = edge ? (edge.actual ?? edge.design) : 0;
  const [text, setText] = useState(mm(Math.abs(current)));
  const [neg, setNeg] = useState(current === 0 ? (edge?.design ?? 0) < 0 : current < 0);
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

  return (
    <>
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
            inputMode="decimal"
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

// ---- a grid spacing ---------------------------------------------------------------------

function GapBody({
  floor,
  axis,
  toId,
  busy,
  onSave,
}: {
  floor: Floor;
  axis: Axis;
  toId: string;
  busy: boolean;
  onSave: SaveFn;
}) {
  const gap = gapsOf(floor, axis).find((g) => g.to.id === toId);
  const [text, setText] = useState(gap ? mm(gap.actual) : "");
  if (!gap) return null;
  const lines = gridLines(floor, axis);
  const after = lines.slice(lines.findIndex((l) => l.id === toId)).map((l) => l.id);
  const typed = parseMm(text);

  const apply = async (value: number, measured: boolean) => {
    const shifts = shiftsForGap(floor, axis, toId, value);
    const delta = value - gap.actual;
    const changes: Change[] = shifts.map((sh) => ({
      path: pathOf("grid", sh.key, "shift"),
      value: Math.round(sh.shift * 10) ? sh.shift : null,
    }));
    changes.push({ path: pathOf("grid", gap.to._key, "measured"), value: measured || null });
    const dir = axis === "x" ? (delta > 0 ? "right" : "left") : delta > 0 ? "down" : "up";
    const moved = Math.round(delta)
      ? ` (line ${toId}${after.length > 1 ? " and the lines after it" : ""} moved ${mm(Math.abs(delta))} ${dir})`
      : "";
    await onSave(
      changes,
      measured
        ? `Grid ${gap.from.id} to ${toId} measured ${mm(value)}${moved}`
        : `Grid ${gap.from.id} to ${toId} back to the drawing${moved}`,
      `${axis}${toId}`,
    );
  };

  return (
    <>
      <p className={s.fact}>
        <span className={s.factStrong}>Drawing:</span> {mm(gap.design)}. <span className={s.factStrong}>Now:</span>{" "}
        {mm(gap.actual)}
        {Math.round(gap.actual) !== Math.round(gap.design) ? ` (${signedMm(gap.actual - gap.design)})` : ""}.
      </p>
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
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
        />
        <span />
      </div>
      <p className={s.hint}>
        This moves line {toId}
        {after.length > 1 ? ` and every line after it (${after.slice(1).join(", ")})` : ""}, with everything set out
        from them. To record one column, tap the column instead.
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
        {(gap.measured || Math.round(gap.actual) !== Math.round(gap.design)) && (
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
