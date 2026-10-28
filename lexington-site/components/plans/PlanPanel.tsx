"use client";

import { useState } from "react";

import type { Axis, BoxEl, Floor } from "@/lib/asbuilt/types";
import { boxOf, gridLines, linePos, resolveFloor } from "@/lib/asbuilt/geometry";
import { moveWall, attachedEnds, setLength, setTarget, updateLabel, updateOpening, updateWall, removeWall, removeOpening, removeLabel, wallLength } from "@/lib/plans/edit";
import { againstStated, refName, refPos, toleranceBand, type P, type PlanAnalysis } from "@/lib/plans/geometry";
import {
  SPACE_TYPES,
  WALL_KINDS,
  type Anchor,
  type OpeningKind,
  type PlanContent,
  type PlanReference,
  type SpaceType,
  type WallKind,
} from "@/lib/plans/types";

import type { Sel, Tool } from "./PlanCanvas";
import s from "./Plans.module.css";

interface Props {
  floor: Floor;
  plan: PlanContent;
  analysis: PlanAnalysis;
  tool: Tool;
  onTool: (t: Tool) => void;
  wallKind: WallKind;
  wallT: number;
  onWall: (kind: WallKind, t: number) => void;
  openingKind: OpeningKind;
  openingW: number;
  onOpening: (kind: OpeningKind, w: number) => void;
  selection: Sel;
  onSelect: (sel: Sel) => void;
  onCommit: (plan: PlanContent, what: string) => void;
  /** The homes the website lists on this floor, with their areas. */
  websiteAreas: Map<string, number>;
  /** Where a home's printable plan is. */
  printHref: (unit: string) => string;
  reference: PlanReference | null;
  referenceShade: number;
  onReferenceShade: (v: number) => void;
  colourOf: (unit: string) => string;
  onFocus: (at: P) => void;
}

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "V" },
  { tool: "wall", label: "Wall", key: "W" },
  { tool: "door", label: "Door", key: "D" },
  { tool: "window", label: "Window", key: "N" },
  { tool: "label", label: "Name a room", key: "R" },
];

const OPENINGS: { kind: OpeningKind; label: string; w: number }[] = [
  { kind: "door", label: "Door", w: 900 },
  { kind: "double", label: "Double door", w: 1500 },
  { kind: "slider", label: "Sliding door", w: 2400 },
  { kind: "window", label: "Window", w: 1500 },
];

const num = (text: string): number | null => {
  const v = Number(text.replace(/[,\s]/g, ""));
  return text.trim() && Number.isFinite(v) ? v : null;
};
const fmt = (mm: number) => Math.round(mm).toLocaleString("en-GB");

/** A number box that saves on Enter or when it loses focus. */
function MmInput({ value, onSave, label, min = 0, blankZero = false }: { value: number; onSave: (v: number) => void; label: string; min?: number; blankZero?: boolean }) {
  const shown = (v: number) => (blankZero && !v ? "" : String(Math.round(v * 10) / 10));
  const [text, setText] = useState(shown(value));
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setText(shown(value));
  }
  const commit = () => {
    const v = num(text);
    if (v !== null && v >= min && Math.abs(v - value) >= 0.05) onSave(v);
    else if (blankZero && !text.trim() && value) onSave(0);
    else setText(shown(value));
  };
  return (
    <input
      className={s.num}
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      onFocus={(e) => e.target.select()}
    />
  );
}

/** What a wall's line can be measured from: the grid lines, column faces and slab edges near it. */
function refsNear(floor: Floor, axis: Axis, v: number, current: string): { ref: string; name: string; d: number }[] {
  const out: { ref: string; name: string; d: number }[] = [];
  const add = (ref: string) => {
    const at = refPos(floor, axis, ref);
    if (at !== null && !out.some((o) => o.ref === ref)) out.push({ ref, name: refName(floor, ref), d: v - at });
  };
  add(current);
  const grid = gridLines(floor, axis)
    .map((g) => ({ id: g.id, d: Math.abs((linePos(floor, axis, g.id, "actual") ?? 1e9) - v) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2);
  for (const g of grid) add(g.id);
  const faces = axis === "x" ? (["l", "r"] as const) : (["t", "b"] as const);
  const near: { ref: string; d: number }[] = [];
  for (const list of ["columns", "cores"] as const) {
    for (const el of floor[list] as BoxEl[]) {
      const b = boxOf(floor, el, "actual");
      if (!b) continue;
      for (const f of faces) {
        const at = f === "l" ? b.x0 : f === "r" ? b.x1 : f === "t" ? b.y0 : b.y1;
        if (Math.abs(at - v) < 3000) near.push({ ref: `c:${list}:${el._key}:${f}`, d: Math.abs(at - v) });
      }
    }
  }
  for (const n of near.sort((a, b) => a.d - b.d).slice(0, 4)) add(n.ref);
  for (const e of floor.slab?.edges ?? []) {
    if (e.axis !== axis) continue;
    const at = resolveFloor(floor).edges.get(e._key);
    if (at !== undefined && Math.abs(at - v) < 4000) add(`e:${e._key}`);
  }
  return out;
}

const sideWord = (axis: Axis, d: number) => (axis === "x" ? (d >= 0 ? "right of" : "left of") : d >= 0 ? "below" : "above");

export function PlanPanel(props: Props) {
  const { floor, plan, analysis, tool, onTool, wallKind, wallT, onWall, openingKind, openingW, onOpening, selection, onSelect, onCommit, websiteAreas, colourOf, onFocus, printHref, reference, referenceShade, onReferenceShade } =
    props;
  const sel = selection;
  const wall = sel?.kind === "wall" ? plan.walls.find((w) => w._key === sel.key) : undefined;
  const line = wall ? analysis.walls.find((w) => w.key === wall._key) : undefined;
  const opening = sel?.kind === "opening" ? plan.openings.find((o) => o._key === sel.key) : undefined;
  const label = sel?.kind === "label" ? plan.labels.find((l) => l._key === sel.key) : undefined;
  const room =
    sel?.kind === "room" ? analysis.rooms.find((r) => r.id === sel.id) : label ? analysis.rooms.find((r) => r.label?._key === label._key) : undefined;
  const units = [...new Set([...websiteAreas.keys(), ...plan.labels.map((l) => l.unit).filter((u): u is string => Boolean(u))])].sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true }),
  );
  const totals = analysis.homes.reduce((t, h) => ({ nia: t.nia + h.nia, outdoor: t.outdoor + h.outdoor }), { nia: 0, outdoor: 0 });

  return (
    <aside className={s.panel}>
      <section className={s.block}>
        <div className={s.blockTitle}>Draw</div>
        <div className={s.chips} role="group" aria-label="Tool">
          {TOOLS.map((t) => (
            <button key={t.tool} type="button" className={tool === t.tool ? s.chipOn : s.chip} aria-pressed={tool === t.tool} onClick={() => onTool(t.tool)} title={`${t.label} (${t.key})`}>
              {t.label}
            </button>
          ))}
        </div>
        {tool === "wall" && (
          <div className={s.settings}>
            <div className={s.chips} role="group" aria-label="Wall type">
              {WALL_KINDS.map((k) => (
                <button key={k.kind} type="button" className={wallKind === k.kind ? s.chipOn : s.chip} aria-pressed={wallKind === k.kind} onClick={() => onWall(k.kind, k.t)}>
                  {k.label}
                </button>
              ))}
            </div>
            <label className={s.field}>
              <span>Thickness, mm</span>
              <MmInput value={wallT} min={10} label="Wall thickness" onSave={(v) => onWall(wallKind, v)} />
            </label>
            <p className={s.hint}>Walls line up on grid lines, column faces, slab edges and other walls, centred or face to face.</p>
          </div>
        )}
        {(tool === "door" || tool === "window") && (
          <div className={s.settings}>
            <div className={s.chips} role="group" aria-label="Kind">
              {OPENINGS.filter((o) => (tool === "window" ? o.kind === "window" : o.kind !== "window")).map((o) => (
                <button key={o.kind} type="button" className={openingKind === o.kind ? s.chipOn : s.chip} aria-pressed={openingKind === o.kind} onClick={() => onOpening(o.kind, o.w)}>
                  {o.label}
                </button>
              ))}
            </div>
            <label className={s.field}>
              <span>Width, mm</span>
              <MmInput value={openingW} min={100} label="Opening width" onSave={(v) => onOpening(openingKind, v)} />
            </label>
            <p className={s.hint}>Click on a wall to put it there.</p>
          </div>
        )}
        {tool === "label" && <p className={s.hint}>Click in a room to name it and say whose home it is.</p>}
        {reference && (
          <label className={s.field}>
            <span>
              Architect&rsquo;s plan underneath{referenceShade === 0 ? " (hidden)" : ""} · {reference.title}
            </span>
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.05}
              value={referenceShade}
              onChange={(e) => onReferenceShade(Number(e.target.value))}
              aria-label="How strongly the architect's plan shows"
            />
          </label>
        )}
      </section>

      {wall && line && (
        <section className={s.block}>
          <div className={s.blockTitle}>Wall</div>
          <div className={s.chips} role="group" aria-label="Wall type">
            {WALL_KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                className={wall.kind === k.kind ? s.chipOn : s.chip}
                aria-pressed={wall.kind === k.kind}
                onClick={() => onCommit(updateWall(plan, wall._key, { kind: k.kind }), `Wall made "${k.label}"`)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className={s.fieldRow}>
            <label className={s.field}>
              <span>Thickness, mm</span>
              <MmInput value={wall.t} min={10} label="Thickness" onSave={(v) => onCommit(updateWall(plan, wall._key, { t: v }), "Wall thickness changed")} />
            </label>
            <label className={s.field}>
              <span>Length, mm</span>
              <MmInput value={wallLength(line)} min={10} label="Length" onSave={(v) => onCommit(setLength(plan, floor, wall._key, v), "Wall length changed")} />
            </label>
          </div>
          <WallPosition floor={floor} plan={plan} wallKey={wall._key} axis={line.dir === "h" ? "y" : "x"} centre={line.c} onCommit={onCommit} />
          <button type="button" className={s.danger} onClick={() => {
            onCommit(removeWall(plan, wall._key), "Wall removed");
            onSelect(null);
          }}>
            Remove wall
          </button>
        </section>
      )}

      {opening && (
        <section className={s.block}>
          <div className={s.blockTitle}>{opening.kind === "window" ? "Window" : "Door"}</div>
          <div className={s.chips}>
            {OPENINGS.map((o) => (
              <button key={o.kind} type="button" className={opening.kind === o.kind ? s.chipOn : s.chip} onClick={() => onCommit(updateOpening(plan, opening._key, { kind: o.kind }), `${o.label} chosen`)}>
                {o.label}
              </button>
            ))}
          </div>
          <div className={s.fieldRow}>
            <label className={s.field}>
              <span>Width, mm</span>
              <MmInput value={opening.w} min={100} label="Width" onSave={(v) => onCommit(updateOpening(plan, opening._key, { w: v }), "Width changed")} />
            </label>
            <label className={s.field}>
              <span>From the wall&rsquo;s end, mm</span>
              <MmInput value={opening.at - opening.w / 2} label="From the wall's end" onSave={(v) => onCommit(updateOpening(plan, opening._key, { at: v + opening.w / 2 }), "Moved along the wall")} />
            </label>
          </div>
          {opening.kind !== "window" && opening.kind !== "slider" && (
            <div className={s.chips}>
              <button type="button" className={s.chip} onClick={() => onCommit(updateOpening(plan, opening._key, { flip: !opening.flip }), "Door swings the other way")}>
                Swing to the other side
              </button>
              <button type="button" className={s.chip} onClick={() => onCommit(updateOpening(plan, opening._key, { hand: !opening.hand }), "Door hinged at the other end")}>
                Hinge at the other end
              </button>
            </div>
          )}
          <button type="button" className={s.danger} onClick={() => {
            onCommit(removeOpening(plan, opening._key), "Removed");
            onSelect(null);
          }}>
            Remove
          </button>
        </section>
      )}

      {(label || room) && (
        <section className={s.block}>
          <div className={s.blockTitle}>Room {room ? `· ${room.area.toFixed(2)} m²` : ""}</div>
          {label ? (
            <>
              <label className={s.field}>
                <span>Name</span>
                <input
                  className={s.text}
                  defaultValue={label.name}
                  key={label._key}
                  onBlur={(e) => e.target.value.trim() !== label.name && onCommit(updateLabel(plan, label._key, { name: e.target.value.trim() || "Room" }), "Room renamed")}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
              </label>
              <div className={s.chips} role="group" aria-label="What it is">
                {SPACE_TYPES.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    className={label.type === t.type ? s.chipOn : s.chip}
                    onClick={() => onCommit(updateLabel(plan, label._key, { type: t.type as SpaceType, ...(t.common ? { unit: null } : {}) }), `Room is a ${t.label.toLowerCase()}`)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {!SPACE_TYPES.find((t) => t.type === label.type)?.common && (
                <label className={s.field}>
                  <span>Home</span>
                  <input
                    className={s.text}
                    list="plan-units"
                    defaultValue={label.unit ?? ""}
                    key={`${label._key}u`}
                    placeholder="e.g. 101A"
                    onBlur={(e) => {
                      const v = e.target.value.trim().toUpperCase().replace(/\s+/g, " ");
                      if (v !== (label.unit ?? "")) onCommit(updateLabel(plan, label._key, { unit: v || null }), v ? `Room is part of ${v}` : "Room taken out of its home");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                </label>
              )}
              <datalist id="plan-units">
                {units.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              <button type="button" className={s.danger} onClick={() => {
                onCommit(removeLabel(plan, label._key), "Room name removed");
                onSelect(null);
              }}>
                Remove the name
              </button>
            </>
          ) : (
            <p className={s.hint}>Not named yet. Use &ldquo;Name a room&rdquo; and click in it.</p>
          )}
        </section>
      )}

      <section className={s.block}>
        <div className={s.blockTitle}>Homes on this floor</div>
        {analysis.homes.length === 0 ? (
          <p className={s.hint}>Name a room and give it a home (e.g. 101A): its net internal area shows here.</p>
        ) : (
          <table className={s.homes}>
            <thead>
              <tr>
                <th>Home</th>
                <th>NIA</th>
                <th>Balcony</th>
                <th title="The area it is sold with: the contract's, else the website's">Sold as</th>
                <th>±</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {analysis.homes.map((h) => {
                const target = plan.targets.find((t) => t.unit === h.unit)?.stated ?? websiteAreas.get(h.unit) ?? null;
                const diff = againstStated(h.nia, target);
                const band = toleranceBand(diff);
                const main = h.rooms[0];
                return (
                  <tr key={h.unit}>
                    <td>
                      <button type="button" className={s.homeName} onClick={() => main && (onFocus(main.spot), main.label && onSelect({ kind: "label", key: main.label._key }))}>
                        <span className={s.dot} style={{ background: colourOf(h.unit) }} />
                        {h.unit}
                      </button>
                    </td>
                    <td className={s.numCell}>{h.nia.toFixed(2)}</td>
                    <td className={s.numCell}>{h.outdoor ? h.outdoor.toFixed(2) : "–"}</td>
                    <td className={s.numCell}>
                      <MmInput value={target ?? 0} blankZero label={`${h.unit} sold as, m²`} onSave={(v) => onCommit(setTarget(plan, h.unit, v || null), v ? `${h.unit} sold as ${v} m²` : `${h.unit}: back to the website's area`)} />
                    </td>
                    <td>
                      <span className={s[`band_${band}`]} title={band === "ok" ? "Within 3%: no price change" : band === "adjust" ? "3% to 7%: the price moves pro rata (clause 2.4)" : band === "rescind" ? "Over 7% smaller: the buyer may rescind (clause 2.4)" : ""}>
                        {diff === null ? "–" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}%`}
                      </span>
                    </td>
                    <td>
                      <a className={s.linkBtn} href={printHref(h.unit)} target="_blank" rel="noopener" title="Its plan with the net internal area, to print or save as a PDF">
                        Plan
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>All</td>
                <td className={s.numCell}>{totals.nia.toFixed(2)}</td>
                <td className={s.numCell}>{totals.outdoor ? totals.outdoor.toFixed(2) : "–"}</td>
                <td colSpan={3} className={s.hint}>
                  shared {analysis.common.toFixed(1)} m²
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className={s.hint}>
          Net internal area as the sale agreement measures it: inside face of the home&rsquo;s walls, balconies apart. Within 3% of what it is
          sold as: no change; 3–7%: the price moves; over 7% smaller: the buyer may cancel.
        </p>
      </section>

      {analysis.problems.length > 0 && (
        <section className={s.block}>
          <div className={s.blockTitle}>To fix ({analysis.problems.length})</div>
          <ul className={s.problems}>
            {analysis.problems.map((p, i) => (
              <li key={i}>
                {p.text}
                {p.at && (
                  <button type="button" className={s.linkBtn} onClick={() => onFocus(p.at!)}>
                    Show
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

/** "Centre line 1,250 mm below grid 3": type the distance, or measure from something else. */
function WallPosition({
  floor,
  plan,
  wallKey,
  axis,
  centre,
  onCommit,
}: {
  floor: Floor;
  plan: PlanContent;
  wallKey: string;
  axis: Axis;
  centre: number;
  onCommit: (p: PlanContent, what: string) => void;
}) {
  const wall = plan.walls.find((w) => w._key === wallKey)!;
  const anchor = axis === "x" ? wall.a.x : wall.a.y;
  const refs = refsNear(floor, axis, centre, anchor.ref);
  const [face, setFace] = useState<"centre" | "minus" | "plus">("centre");
  const off = face === "centre" ? 0 : face === "minus" ? -wall.t / 2 : wall.t / 2;
  const moveTo = (a: Anchor, what: string) => onCommit(moveWall(plan, floor, wallKey, a, attachedEnds(floor, plan, wallKey)), what);
  const shown = anchor.d + off;
  const faceWords = axis === "x" ? { minus: "Left face", plus: "Right face" } : { minus: "Top face", plus: "Bottom face" };
  return (
    <div className={s.position}>
      <div className={s.chips} role="group" aria-label="Measure the wall's">
        {(["centre", "minus", "plus"] as const).map((f) => (
          <button key={f} type="button" className={face === f ? s.chipOn : s.chip} onClick={() => setFace(f)}>
            {f === "centre" ? "Centre" : faceWords[f]}
          </button>
        ))}
      </div>
      <div className={s.fieldRow}>
        <label className={s.field}>
          <span>mm</span>
          <MmInput value={Math.abs(shown)} label="Distance" onSave={(v) => moveTo({ ref: anchor.ref, d: Math.round((Math.sign(shown || 1) * v - off) * 10) / 10 }, "Wall moved")} />
        </label>
        <label className={s.field}>
          <span>{sideWord(axis, shown)}</span>
          <select
            className={s.text}
            value={anchor.ref}
            onChange={(e) => {
              const at = refPos(floor, axis, e.target.value);
              if (at !== null) moveTo({ ref: e.target.value, d: Math.round((centre - at) * 10) / 10 }, `Wall now measured from ${refName(floor, e.target.value)}`);
            }}
          >
            {refs.map((r) => (
              <option key={r.ref} value={r.ref}>
                {r.name} ({fmt(Math.abs(r.d))})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={s.hint}>Measured from what you tape on site: when the as-built changes, the wall moves with it.</p>
    </div>
  );
}
