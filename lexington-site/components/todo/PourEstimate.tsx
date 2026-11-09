"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

import {
  clipToBox,
  DEFAULT_EXTRA,
  EXTRA_CHOICES,
  orderLines,
  orderText,
  slabSpecFor,
  slabWork,
  whatsappLink,
  type Box4,
  type ColumnsInput,
  type EstFloor,
  type EstGrid,
  type EstimateInput,
  type EstimateKind,
  type EstimateResult,
  type ItemKind,
  type OtherInput,
  type Point,
  type PourOrder,
  type SlabInput,
  type SlabWork,
} from "@/lib/concrete/estimate";
import type { ConcreteData, PourBooking } from "@/lib/concrete/shared";
import { errorText, send, when } from "./api";
import es from "./Estimate.module.css";
import styles from "./Todo.module.css";

// The concrete worked out from the building when a pour is booked, and its order to the concrete company on WhatsApp
// (lib/concrete/estimate.ts says what and why).

const fmt = (v: number, digits = 1) => v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const sorted = (g: EstGrid[]) => [...g].sort((a, b) => a.pos - b.pos);
const short = (f: EstFloor) => f.name.replace(/ floor$/i, "");
const pts = (poly: Point[]) => poly.map(([x, y]) => `${x},${y}`).join(" ");
const numberOf = (text: string): number | null => {
  const n = Number(text.replace(",", ".").trim());
  return text.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/* ---------- the building, fetched once while the app is open ---------- */

let floorsCache: Promise<EstFloor[]> | null = null;

export function useEstimateFloors(enabled: boolean): { floors: EstFloor[] | null; error: string } {
  const [floors, setFloors] = useState<EstFloor[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || floors) return;
    let live = true;
    floorsCache ??= send<{ floors: EstFloor[] }>("/api/concrete/estimate", "GET").then((d) => d.floors);
    floorsCache
      .then((f) => {
        if (live) setFloors(f);
      })
      .catch((e) => {
        floorsCache = null;
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [enabled, floors]);
  return { floors, error };
}

/** "1st floor columns" names its floor: the estimate starts there. */
function floorInWords(text: string, floors: EstFloor[]): string | null {
  const t = text.toLowerCase();
  if (/\bground\b/.test(t)) return "g";
  const m = /\b([1-7])(?:st|nd|rd|th)\b/.exec(t);
  if (m && floors.some((f) => f.key === m[1])) return m[1];
  return /\broof\b/.test(t) ? "roof" : null;
}

const columnFloors = (floors: EstFloor[]) => floors.filter((f) => f.items.length > 0);
const slabFloors = (floors: EstFloor[]) => floors.filter((f) => f.outline && slabSpecFor(f.key));

function columnsStart(floors: EstFloor[], key: string | null): ColumnsInput {
  const list = columnFloors(floors);
  const f = list.find((x) => x.key === key) ?? list.find((x) => x.key === "1") ?? list[0];
  return { floor: f?.key ?? "", items: f ? f.items.map((i) => i.id) : [], height: null };
}
function slabStart(floors: EstFloor[], key: string | null): SlabInput {
  const list = slabFloors(floors);
  const f = list.find((x) => x.key === key) ?? list.find((x) => x.key === "2") ?? list[0];
  const xs = f ? sorted(f.xs) : [];
  return { floor: f?.key ?? "", from: xs[0]?.id ?? "", to: xs[xs.length - 1]?.id ?? "", rowFrom: null, rowTo: null, thickness: null, beams: true };
}

/**
 * The estimate when a kind is picked: what was picked before stays (columns to both keeps the columns); a new part
 * starts on the floor the pour's words name ("1st floor columns"), the slab of "both" on the floor above the columns.
 */
export function startEstimate(kind: EstimateKind, prev: EstimateInput | null, floors: EstFloor[], what: string, volume: string): EstimateInput {
  const named = floorInWords(what, floors);
  // Only what the last kind was using carries over (a slab picked for "columns" never was).
  const hadColumns = prev && (prev.kind === "columns" || prev.kind === "both") && prev.columns?.floor ? prev.columns : null;
  const hadSlab = prev && (prev.kind === "slab" || prev.kind === "both") && prev.slab?.floor ? prev.slab : null;
  const below = hadSlab ? (floors.find((f) => f.next?.key === hadSlab.floor)?.key ?? null) : null;
  const columns = hadColumns ?? columnsStart(floors, kind === "both" && below ? below : named);
  const above = floors.find((f) => f.key === columns.floor)?.next?.key ?? null;
  const slab = hadSlab ?? slabStart(floors, kind === "both" ? above : named);
  const other: OtherInput = (prev?.kind === "other" ? prev.other : null) ?? { what: what.trim(), m3: numberOf(volume), slump: "" };
  return { kind, extra: prev?.extra ?? DEFAULT_EXTRA, columns, slab, other };
}

/** Only what the kind uses, for saving. */
export function estimateToSend(v: EstimateInput): EstimateInput {
  return {
    kind: v.kind,
    extra: v.extra,
    ...(v.kind === "columns" || v.kind === "both" ? { columns: v.columns } : {}),
    ...(v.kind === "slab" || v.kind === "both" ? { slab: v.slab } : {}),
    ...(v.kind === "other" ? { other: v.other } : {}),
  };
}

/* ---------- the picker ---------- */

export function EstimatePanel({
  floors,
  error,
  value,
  onChange,
  result,
  disabled,
}: {
  floors: EstFloor[] | null;
  error: string;
  value: EstimateInput;
  onChange: (v: EstimateInput) => void;
  result: EstimateResult | null;
  disabled: boolean;
}) {
  if (error) return <p className={styles.sheetError}>{error}</p>;
  if (!floors) return <p className={styles.sheetNote}>Getting the building&rsquo;s measurements…</p>;
  const set = (patch: Partial<EstimateInput>) => onChange({ ...value, ...patch });
  return (
    <div className={es.panel}>
      {(value.kind === "columns" || value.kind === "both") && value.columns && (
        <ColumnsPicker floors={floors} value={value.columns} onChange={(columns) => set({ columns })} disabled={disabled} titled={value.kind === "both"} />
      )}
      {(value.kind === "slab" || value.kind === "both") && value.slab && (
        <SlabPicker floors={floors} value={value.slab} onChange={(slab) => set({ slab })} disabled={disabled} titled={value.kind === "both"} />
      )}
      {value.kind === "other" && value.other && <OtherPicker value={value.other} onChange={(other) => set({ other })} disabled={disabled} />}
      <Summary result={result} extra={value.extra} onExtra={(extra) => set({ extra })} disabled={disabled} />
    </div>
  );
}

function FloorChips({ floors, value, onPick, disabled, label }: { floors: EstFloor[]; value: string; onPick: (f: EstFloor) => void; disabled: boolean; label: string }) {
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {floors.map((f) => (
        <button key={f.key} type="button" className={value === f.key ? styles.chipOn : styles.chip} aria-pressed={value === f.key} onClick={() => onPick(f)} disabled={disabled}>
          {short(f)}
        </button>
      ))}
    </div>
  );
}

const GROUPS: Array<{ kind: ItemKind; one: string; many: string }> = [
  { kind: "column", one: "Column", many: "Columns" },
  { kind: "wall", one: "Wall", many: "Walls" },
  { kind: "lift", one: "Lift", many: "Lifts" },
];

function ColumnsPicker({ floors, value, onChange, disabled, titled }: { floors: EstFloor[]; value: ColumnsInput; onChange: (v: ColumnsInput) => void; disabled: boolean; titled: boolean }) {
  const list = columnFloors(floors);
  const floor = list.find((f) => f.key === value.floor) ?? null;
  const [height, setHeight] = useState(value.height ? String(value.height) : "");
  const picked = new Set(value.items);
  const put = (next: Set<string>) => onChange({ ...value, items: (floor?.items ?? []).filter((i) => next.has(i.id)).map((i) => i.id) });
  const flip = (ids: string[]) => {
    if (!ids.length) return;
    const next = new Set(picked);
    const allOn = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (allOn) next.delete(id);
      else next.add(id);
    }
    put(next);
  };
  const onLine = (axis: "x" | "y", id: string) => flip((floor?.items ?? []).filter((i) => i.kind !== "lift" && i.ref.split("/")[axis === "x" ? 0 : 1] === id).map((i) => i.id));
  const floorToFloor = floor?.next ? (floor.next.level - floor.level) / 1000 : null;
  return (
    <section className={es.block} aria-label="Columns">
      {titled && <h3 className={es.blockTitle}>Columns</h3>}
      <span className={styles.label}>The columns on</span>
      <FloorChips floors={list} value={value.floor} onPick={(f) => onChange({ ...value, floor: f.key, items: f.items.map((i) => i.id) })} disabled={disabled} label="Floor the columns stand on" />
      {floor && (
        <>
          <p className={es.note}>
            {floor.next ? `Standing on the ${floor.name.toLowerCase()} slab, up to the ${floor.next.name.toLowerCase()}` : `On the ${floor.name.toLowerCase()}`}
            {floorToFloor ? `: ${fmt(floorToFloor, 2)} m floor to floor.` : "."}
          </p>
          <EstimatePlan floor={floor} mode="columns" picked={picked} onToggle={(id) => flip([id])} onLine={onLine} />
          <p className={es.hint}>
            Tap a column to take it off or put it back; a grid letter or number does its whole line.
            <span className={es.swipe}> Swipe the plan sideways for the rest of the building.</span>
          </p>
          <div className={styles.chips} role="group" aria-label="Pick by kind">
            {GROUPS.map((g) => {
              const ids = floor.items.filter((i) => i.kind === g.kind).map((i) => i.id);
              if (!ids.length) return null;
              const on = ids.every((id) => picked.has(id));
              return (
                <button key={g.kind} type="button" className={on ? styles.chipOn : styles.chip} aria-pressed={on} onClick={() => flip(ids)} disabled={disabled}>
                  {ids.length === 1 ? g.one : `${g.many} (${ids.length})`}
                </button>
              );
            })}
          </div>
        </>
      )}
      <label className={styles.label} htmlFor="est-height">
        Height of this pour (m)
      </label>
      <input
        id="est-height"
        className={styles.input}
        inputMode="decimal"
        value={height}
        placeholder={floorToFloor ? `e.g. ${fmt(Math.max(0.5, floorToFloor - 0.5), 1)}` : "e.g. 3.0"}
        onChange={(e) => {
          setHeight(e.target.value);
          onChange({ ...value, height: numberOf(e.target.value) });
        }}
        disabled={disabled}
      />
    </section>
  );
}

function SlabPicker({ floors, value, onChange, disabled, titled }: { floors: EstFloor[]; value: SlabInput; onChange: (v: SlabInput) => void; disabled: boolean; titled: boolean }) {
  const list = slabFloors(floors);
  const floor = list.find((f) => f.key === value.floor) ?? null;
  const xs = floor ? sorted(floor.xs) : [];
  const ys = floor ? sorted(floor.ys) : [];
  const spec = floor ? slabSpecFor(floor.key) : null;
  const work = floor ? slabWork(floor, value) : null;
  const [thick, setThick] = useState(value.thickness ? String(value.thickness) : "");
  const rows = !!(value.rowFrom || value.rowTo);
  const pickFloor = (f: EstFloor) => {
    const fx = sorted(f.xs);
    const has = (id: string) => fx.some((g) => g.id === id);
    onChange({ ...value, floor: f.key, from: has(value.from) ? value.from : (fx[0]?.id ?? ""), to: has(value.to) ? value.to : (fx[fx.length - 1]?.id ?? ""), rowFrom: null, rowTo: null });
  };
  return (
    <section className={es.block} aria-label="Slab">
      {titled && <h3 className={es.blockTitle}>Slab</h3>}
      <span className={styles.label}>Which slab</span>
      <FloorChips floors={list} value={value.floor} onPick={pickFloor} disabled={disabled} label="Which slab" />
      {floor && (
        <>
          <div className={es.grid2}>
            <label className={styles.label}>
              From grid
              <select className={styles.input} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} disabled={disabled} aria-label="From grid">
                {xs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.id}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.label}>
              To grid
              <select className={styles.input} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} disabled={disabled} aria-label="To grid">
                {xs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={es.hint}>
            {xs[0]?.id} and {xs[xs.length - 1]?.id} take in the slab past them, out to its edge.
          </p>
          <div className={styles.chips}>
            <button
              type="button"
              className={rows ? styles.chip : styles.chipOn}
              aria-pressed={!rows}
              onClick={() => onChange({ ...value, rowFrom: rows ? null : (ys[0]?.id ?? null), rowTo: rows ? null : (ys[ys.length - 1]?.id ?? null) })}
              disabled={disabled}
            >
              {rows ? "Only some rows" : "The whole width"}
            </button>
          </div>
          {rows && (
            <div className={es.grid2}>
              <label className={styles.label}>
                From row
                <select className={styles.input} value={value.rowFrom ?? ""} onChange={(e) => onChange({ ...value, rowFrom: e.target.value })} disabled={disabled} aria-label="From row">
                  {ys.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.label}>
                To row
                <select className={styles.input} value={value.rowTo ?? ""} onChange={(e) => onChange({ ...value, rowTo: e.target.value })} disabled={disabled} aria-label="To row">
                  {ys.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {work && typeof work !== "string" && (
            <>
              <EstimatePlan floor={floor} mode="slab" work={work} />
              <p className={es.hint}>
                The part poured is shaded; the beams counted are dashed.
                <span className={es.swipe}> Swipe the plan sideways for the rest of the building.</span>
              </p>
            </>
          )}
          <div className={es.grid2}>
            <label className={styles.label}>
              Thickness (mm)
              <input
                className={styles.input}
                inputMode="numeric"
                value={thick}
                placeholder={spec ? `${[...new Set(spec.zones.map((z) => z.t))].join(" / ")} drawing` : "e.g. 200"}
                onChange={(e) => {
                  setThick(e.target.value);
                  onChange({ ...value, thickness: numberOf(e.target.value) });
                }}
                disabled={disabled}
                aria-label="Thickness (mm)"
              />
            </label>
            <div className={es.beamPick}>
              <span className={styles.label}>Beams under it</span>
              <button type="button" className={value.beams !== false ? styles.chipOn : styles.chip} aria-pressed={value.beams !== false} onClick={() => onChange({ ...value, beams: value.beams === false })} disabled={disabled}>
                {value.beams !== false ? "Counted" : "Left out"}
              </button>
            </div>
          </div>
          {spec && <p className={es.note}>Thickness and beams from {spec.source}.</p>}
          {spec?.borrowed && <p className={es.warn}>{spec.borrowed}</p>}
        </>
      )}
    </section>
  );
}

function OtherPicker({ value, onChange, disabled }: { value: OtherInput; onChange: (v: OtherInput) => void; disabled: boolean }) {
  const [m3, setM3] = useState(value.m3 ? String(value.m3) : "");
  const [size, setSize] = useState({ l: "", w: "", d: "" });
  const putSize = (next: { l: string; w: string; d: string }) => {
    setSize(next);
    const [l, w, d] = [numberOf(next.l), numberOf(next.w), numberOf(next.d)];
    if (l && w && d) {
      const v = Math.round(l * w * d * 100) / 100;
      setM3(String(v));
      onChange({ ...value, m3: v });
    }
  };
  return (
    <section className={es.block} aria-label="Other">
      <label className={styles.label} htmlFor="est-other-what">
        What it is
      </label>
      <input id="est-other-what" className={styles.input} value={value.what} maxLength={80} placeholder="e.g. Stair 1 flights" onChange={(e) => onChange({ ...value, what: e.target.value })} disabled={disabled} />
      <div className={es.grid2}>
        <label className={styles.label}>
          m³
          <input
            className={styles.input}
            inputMode="decimal"
            value={m3}
            placeholder="e.g. 6"
            onChange={(e) => {
              setM3(e.target.value);
              onChange({ ...value, m3: numberOf(e.target.value) });
            }}
            disabled={disabled}
            aria-label="m³"
          />
        </label>
        <label className={styles.label}>
          Slump
          <input className={styles.input} value={value.slump ?? ""} maxLength={20} placeholder="e.g. 15–17 cm" onChange={(e) => onChange({ ...value, slump: e.target.value })} disabled={disabled} aria-label="Slump" />
        </label>
      </div>
      <span className={styles.label}>Or its size, in metres</span>
      <div className={es.size}>
        <input className={styles.input} inputMode="decimal" value={size.l} placeholder="Length" onChange={(e) => putSize({ ...size, l: e.target.value })} disabled={disabled} aria-label="Length (m)" />
        <span aria-hidden="true">×</span>
        <input className={styles.input} inputMode="decimal" value={size.w} placeholder="Width" onChange={(e) => putSize({ ...size, w: e.target.value })} disabled={disabled} aria-label="Width (m)" />
        <span aria-hidden="true">×</span>
        <input className={styles.input} inputMode="decimal" value={size.d} placeholder="Depth" onChange={(e) => putSize({ ...size, d: e.target.value })} disabled={disabled} aria-label="Depth (m)" />
      </div>
    </section>
  );
}

function Summary({ result, extra, onExtra, disabled }: { result: EstimateResult | null; extra: number; onExtra: (e: number) => void; disabled: boolean }) {
  if (!result) return null;
  return (
    <div className={es.summary} aria-live="polite" aria-label="Worked out">
      {result.parts.map((p) => (
        <div key={p.label} className={es.part}>
          <p className={es.partTop}>
            <b>{p.label}</b>
            <span>{fmt(p.m3)} m³</span>
          </p>
          {p.lines.length > 0 && (
            <ul className={es.lines}>
              {p.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {result.problem && <p className={es.problem}>{result.problem}</p>}
      <span className={styles.label}>Add a little over</span>
      <div className={styles.chips} role="group" aria-label="Add a little over">
        {EXTRA_CHOICES.map((e) => (
          <button key={e} type="button" className={extra === e ? styles.chipOn : styles.chip} aria-pressed={extra === e} onClick={() => onExtra(e)} disabled={disabled}>
            {e ? `+${e}%` : "Exact"}
          </button>
        ))}
      </div>
      {result.order > 0 && !result.problem && (
        <p className={es.total}>
          Works out at <b>{fmt(result.m3)} m³</b>: order <b>{result.order} m³</b>
        </p>
      )}
    </div>
  );
}

/* ---------- the plan ---------- */

const KIND_ORDER: Record<ItemKind, number> = { lift: 0, wall: 1, column: 2 };
/** Tap targets are at least this big, mm (a 300 mm column is only a few pixels on a phone). */
const HIT = 1500;
const BUBBLE = 760;

/** Grid bubbles stepped out of each other's way where two lines are close (2b and 3, 7a and 7b). */
function bubbleSpots(lines: EstGrid[]): Array<{ g: EstGrid; out: number }> {
  let prev: { pos: number; out: number } | null = null;
  return lines.map((g) => {
    const out = prev && g.pos - prev.pos < BUBBLE * 2.1 && prev.out === 0 ? 1 : 0;
    prev = { pos: g.pos, out };
    return { g, out };
  });
}

function EstimatePlan({
  floor,
  mode,
  picked,
  onToggle,
  onLine,
  work,
}: {
  floor: EstFloor;
  mode: "columns" | "slab";
  picked?: Set<string>;
  onToggle?: (id: string) => void;
  onLine?: (axis: "x" | "y", id: string) => void;
  work?: SlabWork;
}) {
  const xs = sorted(floor.xs);
  const ys = sorted(floor.ys);
  const allX = [...xs.map((g) => g.pos), ...(floor.outline ?? []).map((p) => p[0]), ...floor.items.flatMap((i) => [i.box[0], i.box[2]])];
  const allY = [...ys.map((g) => g.pos), ...(floor.outline ?? []).map((p) => p[1]), ...floor.items.flatMap((i) => [i.box[1], i.box[3]])];
  const x0 = Math.min(...allX);
  const x1 = Math.max(...allX);
  const y0 = Math.min(...allY);
  const y1 = Math.max(...allY);
  const top = y0 - 1400;
  const left = x0 - 1400;
  const step = BUBBLE * 2.2;
  // Room for the bubbles, the stepped-out ones too, all round.
  const vb = [left - 2 * BUBBLE - step - 300, top - 2 * BUBBLE - step - 300, x1 - left + 2 * BUBBLE + step + 1100, y1 - top + 2 * BUBBLE + step + 1100].join(" ");
  const press = (e: KeyboardEvent, go: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go();
    }
  };
  const items = [...floor.items].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const box = (b: Box4) => ({ x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] });
  const clickable = mode === "columns" && !!onLine;
  return (
    <div className={es.planWrap}>
      <svg className={es.plan} viewBox={vb} role="group" aria-label={`${floor.name} plan`}>
        {floor.outline && <polygon className={mode === "slab" ? es.slabRest : es.outline} points={pts(floor.outline)} />}
        {mode === "slab" && work && floor.outline && <polygon className={es.slabPicked} points={pts(clipToBox(floor.outline, work.box))} />}
        {xs.map((g) => (
          <line key={`x${g.id}`} className={es.gridLine} x1={g.pos} x2={g.pos} y1={top} y2={y1 + 500} />
        ))}
        {ys.map((g) => (
          <line key={`y${g.id}`} className={es.gridLine} x1={left} x2={x1 + 500} y1={g.pos} y2={g.pos} />
        ))}
        {floor.openings
          .filter((o) => o.kind !== "lift")
          .map((o) => (
            <g key={`${o.name}${o.box.join(",")}`} className={mode === "slab" ? es.hole : es.holeFaint}>
              <rect {...box(o.box)} />
              <path d={`M${o.box[0]},${o.box[1]}L${o.box[2]},${o.box[3]}M${o.box[2]},${o.box[1]}L${o.box[0]},${o.box[3]}`} />
            </g>
          ))}
        {mode === "slab" && work?.beamLines.map((b, i) => <line key={i} className={es.beam} x1={b[0]} y1={b[1]} x2={b[2]} y2={b[3]} />)}
        {items.map((it) => {
          const on = mode === "columns" && !!picked?.has(it.id);
          if (it.kind === "lift" && it.wall) {
            const w = it.wall;
            return (
              <g key={it.id} className={mode === "slab" ? es.faint : on ? es.liftOn : es.lift}>
                <rect {...box(it.box)} />
                <rect className={es.shaft} {...box([it.box[0] + w, it.box[1] + w, it.box[2] - w, it.box[3] - w])} />
              </g>
            );
          }
          return <rect key={it.id} className={mode === "slab" ? es.faint : on ? es.itemOn : es.item} {...box(it.box)} />;
        })}
        {mode === "columns" &&
          onToggle &&
          items.map((it) => {
            const on = !!picked?.has(it.id);
            const [bx0, by0, bx1, by1] = it.box;
            const w = Math.max(HIT, bx1 - bx0);
            const h = Math.max(HIT, by1 - by0);
            const cx = (bx0 + bx1) / 2;
            const cy = (by0 + by1) / 2;
            return (
              <rect
                key={`hit${it.id}`}
                className={es.hit}
                x={cx - w / 2}
                y={cy - h / 2}
                width={w}
                height={h}
                role="button"
                tabIndex={0}
                aria-label={`${it.name} at ${it.ref}`}
                aria-pressed={on}
                onClick={() => onToggle(it.id)}
                onKeyDown={(e) => press(e, () => onToggle(it.id))}
              >
                <title>{`${it.name} at ${it.ref}`}</title>
              </rect>
            );
          })}
        {bubbleSpots(xs).map(({ g, out }) => {
          const cy = top - BUBBLE - out * step;
          return (
            <g
              key={`bx${g.id}`}
              className={clickable ? es.bubbleTap : es.bubble}
              {...(clickable
                ? { role: "button", tabIndex: 0, "aria-label": `Grid ${g.id}`, onClick: () => onLine!("x", g.id), onKeyDown: (e: KeyboardEvent) => press(e, () => onLine!("x", g.id)) }
                : {})}
            >
              <circle cx={g.pos} cy={cy} r={BUBBLE} />
              <text x={g.pos} y={cy}>
                {g.id}
              </text>
            </g>
          );
        })}
        {bubbleSpots(ys).map(({ g, out }) => {
          const cx = left - BUBBLE - out * step;
          return (
            <g
              key={`by${g.id}`}
              className={clickable ? es.bubbleTap : es.bubble}
              {...(clickable
                ? { role: "button", tabIndex: 0, "aria-label": `Row ${g.id}`, onClick: () => onLine!("y", g.id), onKeyDown: (e: KeyboardEvent) => press(e, () => onLine!("y", g.id)) }
                : {})}
            >
              <circle cx={cx} cy={g.pos} r={BUBBLE} />
              <text x={cx} y={g.pos}>
                {g.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------- the order on WhatsApp ---------- */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_RE = /^[+\d][\d\s()-]{5,22}$/;

/** The order to the concrete company for a booked pour: checked, then sent on WhatsApp (or copied). */
export function PourOrderSheet({
  booking: b,
  defaults,
  onClose,
  onData,
  onToast,
}: {
  booking: PourBooking;
  defaults: Partial<PourOrder> | null | undefined;
  onClose: () => void;
  onData: (data: ConcreteData) => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const saved = b.order ?? null;
  const fresh = orderLines(b.what, b.volume, b.estimate?.result.parts);
  // The lines last sent, unless the pour's m³ or its estimate changed since.
  const savedLines =
    saved && Math.abs(saved.lines.reduce((s, l) => s + l.m3, 0) - (b.volume ?? 0)) < 0.05 && (!b.estimate || saved.sentAt >= b.estimate.at) ? saved.lines : null;
  const [form, setForm] = useState<PourOrder>(() => ({
    supplier: saved?.supplier ?? defaults?.supplier ?? "Consar",
    phone: saved?.phone ?? defaults?.phone ?? "",
    time: saved?.time ?? defaults?.time ?? "07:00",
    pump: saved?.pump ?? defaults?.pump ?? true,
    contact: saved?.contact ?? defaults?.contact ?? "",
    notes: saved?.notes ?? "",
    mix: b.mix,
    lines: savedLines ?? fresh,
  }));
  const [m3Text, setM3Text] = useState<string[]>(() => form.lines.map((l) => (l.m3 ? String(l.m3) : "")));
  const [error, setError] = useState("");
  const text = orderText(b.day, form);
  const problem = form.lines.some((l) => !(l.m3 > 0))
    ? "Type the m³ of each part."
    : form.phone.trim() && !PHONE_RE.test(form.phone.trim())
      ? "Type their WhatsApp number in digits, e.g. 024 123 4567."
      : form.time && !TIME_RE.test(form.time)
        ? "Pick the time of the first truck."
        : null;
  const set = (patch: Partial<PourOrder>) => setForm((f) => ({ ...f, ...patch }));
  const setLine = (i: number, patch: Partial<PourOrder["lines"][number]>) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  // Kept with the pour as it's sent. The request outlives the page if WhatsApp takes over the screen.
  const keep = () => {
    void fetch("/api/concrete/pours", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "order", id: b.id, order: form }),
      keepalive: true,
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "The order wasn't kept with the pour.");
        onData(data as ConcreteData);
      })
      .catch((e) => onToast(errorText(e), true));
  };
  const copy = async () => {
    if (problem) return setError(problem);
    try {
      await navigator.clipboard.writeText(text);
      keep();
      onToast(`Order copied: paste it in WhatsApp to ${form.supplier.trim() || "the concrete company"}`);
      onClose();
    } catch {
      setError("Couldn't copy it on this phone: use Send on WhatsApp.");
    }
  };

  return (
    <div className={styles.sheetBackdrop}>
      <div className={styles.sheet} role="dialog" aria-label="Concrete order">
        <h2 className={styles.sheetTitle}>Concrete order</h2>
        <p className={styles.sheetNote}>
          {b.what}, {pourWhen(b.day)}
        </p>
        <div className={es.grid2}>
          <label className={styles.label}>
            Concrete company
            <input className={styles.input} value={form.supplier} maxLength={60} onChange={(e) => set({ supplier: e.target.value })} aria-label="Concrete company" />
          </label>
          <label className={styles.label}>
            Their WhatsApp
            <input className={styles.input} type="tel" inputMode="tel" value={form.phone} placeholder="e.g. 024 123 4567" onChange={(e) => set({ phone: e.target.value })} aria-label="Their WhatsApp" />
          </label>
          <label className={styles.label}>
            First truck on site
            <input className={styles.input} type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} aria-label="First truck on site" />
          </label>
          <label className={styles.label}>
            Strength
            <input className={styles.input} value={form.mix} maxLength={30} placeholder="e.g. C35" onChange={(e) => set({ mix: e.target.value })} aria-label="Strength" />
          </label>
        </div>
        <span className={styles.label}>How much</span>
        {form.lines.map((l, i) => (
          <div key={i} className={es.orderLine}>
            <input className={`${styles.input} ${es.orderLabel}`} value={l.label} maxLength={80} onChange={(e) => setLine(i, { label: e.target.value })} aria-label={`Part ${i + 1}`} />
            <input
              className={styles.input}
              inputMode="decimal"
              value={m3Text[i] ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setM3Text((t) => t.map((x, j) => (j === i ? v : x)));
                setLine(i, { m3: numberOf(v) ?? 0 });
              }}
              aria-label={`m³ of part ${i + 1}`}
            />
            <span className={es.unit}>m³</span>
            <span className={es.unit}>slump</span>
            <input className={styles.input} value={l.slump} maxLength={20} placeholder="e.g. 15–17 cm" onChange={(e) => setLine(i, { slump: e.target.value })} aria-label={`Slump of part ${i + 1}`} />
          </div>
        ))}
        <span className={styles.label}>Pump</span>
        <div className={styles.chips}>
          <button type="button" className={form.pump ? styles.chipOn : styles.chip} aria-pressed={form.pump} onClick={() => set({ pump: true })}>
            Pump needed
          </button>
          <button type="button" className={!form.pump ? styles.chipOn : styles.chip} aria-pressed={!form.pump} onClick={() => set({ pump: false })}>
            No pump
          </button>
        </div>
        <label className={styles.label} htmlFor="po-contact">
          On site (name and number)
        </label>
        <input id="po-contact" className={styles.input} value={form.contact} maxLength={80} placeholder="e.g. Albert, 024 123 4567" onChange={(e) => set({ contact: e.target.value })} />
        <label className={styles.label} htmlFor="po-notes">
          Note (if any)
        </label>
        <textarea id="po-notes" className={styles.textarea} rows={2} value={form.notes} maxLength={400} placeholder="e.g. Trucks 20 minutes apart" onChange={(e) => set({ notes: e.target.value })} />
        <span className={styles.label}>The message</span>
        <pre className={es.preview} aria-label="The message">
          {text}
        </pre>
        {saved?.sentAt && <p className={styles.sheetNote}>Last sent {when(saved.sentAt)}{saved.sentBy ? ` by ${saved.sentBy}` : ""}.</p>}
        {(error || problem) && (
          <p className={styles.sheetError} role="alert">
            {error || problem}
          </p>
        )}
        <button type="button" className={es.copy} onClick={() => void copy()}>
          Copy the message
        </button>
        <div className={styles.sheetButtons}>
          <button type="button" className={styles.sheetCancel} onClick={onClose}>
            Close
          </button>
          <a
            className={`${styles.sheetSave} ${es.send}`}
            href={problem ? undefined : whatsappLink(form.phone, text)}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!!problem}
            onClick={(e) => {
              if (problem) {
                e.preventDefault();
                setError(problem);
                return;
              }
              keep();
              onToast("Order opened in WhatsApp: check it and press send");
              onClose();
            }}
          >
            Send on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

function pourWhen(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}
