import { internationalDigits } from "@/lib/format";
import { POSTAL_ADDRESS } from "@/lib/seo";

// How much concrete a pour takes, worked out from the building (Niko, 9 Nov 2026: "in the concrete pour when I book
// it, a concrete estimated quantity tool that using my building measurements where I can select what I'm going to
// pour, so if I choose columns then let me select the columns and lift to pour and i'll put in the height and it
// estimates it for me, if i choose slab then i can select which slab and up to how much of the building to pour, so
// say from grid h to n. or i can choose both. or i can pick other. then make me a short concrete order form that i
// can whatsapp to the concrete company with the details. the strength, the slump, etc." and "For columns it's a high
// slump around 20-22cm. for slab its around 15-17cm.").
//
//  - Columns, walls and lift cores: their size on plan from the as-built record (taped on site where it was, else
//    the drawing) times the height typed. A lift core is its walls (the shaft inside is empty) less its door.
//  - A slab: its outline from the as-built record between the grid lines picked, less its openings (voids, stair
//    wells, the pool, the lift shafts), times its thickness from the engineer's drawing; plus the beams under it,
//    each from the drawing's beam schedule: its depth below the slab times its width, along its grid line where the
//    slab is (where two beams cross, the crossing counts once).
//
// Positions are the as-built record's: mm, x to the right from grid B, y down the page from grid 2. Shared by the
// phone (it works the figures out as things are tapped) and the server (it works them out again before saving).

export type Point = [number, number];
/** x0, y0, x1, y1 in mm. */
export type Box4 = [number, number, number, number];

/* ---------- the building, as the estimate needs it (lib/concrete/estimateServer.ts makes it from the record) ---------- */

export interface EstGrid {
  id: string;
  /** Where the line is as built, mm (x from grid B, y from grid 2). */
  pos: number;
}
export type ItemKind = "column" | "wall" | "lift";
export interface EstItem {
  /** "c:<key>" for a column or wall, "k:<key>" for a lift core. */
  id: string;
  /** The drawing's mark (C1, SW4) or the core's name (Lift 1). */
  name: string;
  /** Its grid lines, e.g. "D/3". */
  ref: string;
  kind: ItemKind;
  box: Box4;
  /** A lift core's wall thickness, mm. */
  wall?: number;
  /** A lift core's door: which side and how wide, mm. */
  door?: { side: "t" | "b" | "l" | "r"; width: number } | null;
}
export interface EstOpening {
  name: string;
  kind: "void" | "stair" | "pool" | "duct" | "lift";
  box: Box4;
}
export interface EstFloor {
  key: string;
  /** "1st floor", "Roof". */
  name: string;
  short: string;
  /** Its slab level, mm. */
  level: number;
  /** The floor above (its slab is what the columns hold up). */
  next: { key: string; name: string; level: number } | null;
  /** Lettered lines across (x) and numbered rows down (y), in order. */
  xs: EstGrid[];
  ys: EstGrid[];
  /** The slab's outline (null: no slab drawn on this floor in the record). */
  outline: Point[] | null;
  /** The columns, walls and lift cores standing on this floor (they hold up the floor above). */
  items: EstItem[];
  /** The holes in this floor's slab: voids, stair wells, the pool, the lift shafts. */
  openings: EstOpening[];
}

/* ---------- each slab as the engineer drew it ---------- */

/** A slab thickness over part of the floor: from one lettered line to another (none = to the slab's edge). */
export interface SlabZone {
  from?: string;
  to?: string;
  /** mm */
  t: number;
}
/** One beam under a slab, as the engineer's beam schedule names it ("500x300 beam on grid line 3/B-N"). */
export interface BeamRun {
  /** Along a numbered row (it runs left to right) or down a lettered line. */
  along: "row" | "line";
  /** The grid line it's on, or mm from grid 2 (rows) / grid B (lines) where it's off the grid. */
  at: string | number;
  /** Where it starts and ends: grid lines, or "edge" for the slab's edge. */
  from: string;
  to: string;
  /** The drawing's size: depth (the slab included) x width, mm. */
  depth: number;
  width: number;
  /** A beam along the slab's edge (the balconies): it runs the whole span between its grid lines. */
  edge?: boolean;
}
export interface SlabSpec {
  /** Which drawing the thickness and beams come from. */
  source: string;
  /** Set when the floor has no drawing of its own yet. */
  borrowed?: string;
  zones: SlabZone[];
  beams: BeamRun[];
}

const beam = (along: "row" | "line", at: string | number, from: string, to: string, size: string, edge = false): BeamRun => {
  const [depth, width] = size.split("x").map(Number);
  return { along, at, from, to, depth, width, ...(edge ? { edge: true } : {}) };
};
const row = (at: string | number, from: string, to: string, size: string, edge = false) => beam("row", at, from, to, size, edge);
const lines = (ids: string[], from: string, to: string, size: string) => ids.map((id) => beam("line", id, from, to, size));
/** "Off 6" on the drawings: the beam under the lift cores' and stairs' far side, 2475 below grid 5. */
const OFF_6 = 11375 + 2475;

// The beam schedules (bending schedules) of each floor's drawings, read off the sheets. A "200x450" beam inside a
// 200 mm slab has nothing below the slab, so those are left out.
const FIRST_FLOOR: SlabSpec = {
  source: "the 1st floor drawings (revised 10 Oct 2026): 200 mm slab, 600 mm deep beams",
  zones: [{ t: 200 }],
  beams: [
    row("2", "B", "edge", "600x300"),
    row("3", "B", "N", "600x300"),
    row("5", "B", "B1", "600x300"),
    row("5", "C", "N", "600x300"),
    row("7", "B", "N", "600x300"),
    ...lines(["B", "C"], "2", "7b", "600x300"),
    ...lines(["D"], "3", "7a", "600x300"),
    ...lines(["F"], "3", "edge", "600x300"),
    ...lines(["G", "H", "K", "L", "M", "N"], "3", "7b", "600x300"),
    ...lines(["E", "J"], "6", "7", "600x200"),
  ],
};
const SECOND_FLOOR: SlabSpec = {
  source: "the 2nd floor drawings (revised 12 Oct 2026): 200 mm slab with 500 mm deep beams from B to G, 250 mm flat slab from G to N",
  zones: [
    { to: "G", t: 200 },
    { from: "G", t: 250 },
  ],
  beams: [
    row("2", "B", "edge", "500x300"),
    row("3", "B", "G", "500x300"),
    row("5", "B", "G", "500x300"),
    row(OFF_6, "B", "G", "500x300"),
    row("7", "C", "G", "500x300"),
    row("7b", "C", "D", "500x150", true),
    row("7a", "D", "G", "500x150", true),
    ...lines(["B"], "2", "5", "500x300"),
    ...lines(["C"], "2", "7b", "500x300"),
    ...lines(["D"], "3", "7b", "500x300"),
    ...lines(["F"], "3", "edge", "500x300"),
    ...lines(["G"], "2b", "7b", "500x300"),
    // On the drawing's plan by the stairs in the flat slab (not in its beam schedule).
    row("3", "G", "H", "500x250"),
    row("5", "H", "J", "500x300"),
  ],
};
const THIRD_FLOOR_BEAMS: BeamRun[] = [
  row("2", "B", "edge", "500x300"),
  row("3", "B", "N", "500x300"),
  row("5", "B", "N", "500x300"),
  row(OFF_6, "B", "G", "500x250"),
  row(OFF_6, "H", "K", "500x250"),
  row("7", "C", "N", "500x300"),
  row("7a", "C", "D", "500x200", true),
  row("7a", "F", "H", "500x200", true),
  row("7a", "K", "N", "500x200", true),
  ...lines(["B"], "2", "5", "500x300"),
  ...lines(["C"], "2", "edge", "500x300"),
  ...lines(["D", "F", "G", "H", "K", "L", "M", "N"], "3", "edge", "500x300"),
];
const THIRD_FLOOR: SlabSpec = {
  source: "the 3rd floor drawings (R28, 2 Nov 2026): 175 mm slab, 500 mm deep beams",
  zones: [{ t: 175 }],
  beams: THIRD_FLOOR_BEAMS,
};
const FOURTH_FLOOR: SlabSpec = {
  source: "the 4th floor plan in the 3rd floor drawings (R28, 2 Nov 2026): 175 mm slab, 500 mm deep beams as the 3rd floor's",
  zones: [{ t: 175 }],
  beams: THIRD_FLOOR_BEAMS,
};
const SPECS: Record<string, SlabSpec> = { "1": FIRST_FLOOR, "2": SECOND_FLOOR, "3": THIRD_FLOOR, "4": FOURTH_FLOOR };

/** The slab's thickness and beams for a floor: its own drawing, else the 4th floor's (the latest one there is). */
export function slabSpecFor(floorKey: string): SlabSpec | null {
  if (SPECS[floorKey]) return SPECS[floorKey];
  if (floorKey === "g") return null;
  return { ...FOURTH_FLOOR, borrowed: "No drawing for this floor yet: the 4th floor's slab and beams are used. Check with the engineer's drawing when it comes." };
}

/* ---------- what's picked ---------- */

export type EstimateKind = "columns" | "slab" | "both" | "other";
export const ESTIMATE_KINDS: EstimateKind[] = ["columns", "slab", "both", "other"];
export const KIND_NAMES: Record<EstimateKind, string> = { columns: "Columns", slab: "Slab", both: "Both", other: "Other" };

export interface ColumnsInput {
  floor: string;
  /** EstItem ids. */
  items: string[];
  /** Metres, as typed. */
  height: number | null;
}
export interface SlabInput {
  floor: string;
  /** Lettered lines: from one to the other (the first and last reach the slab's edge). */
  from: string;
  to: string;
  /** Numbered rows, when only part of the width is poured (none: the whole width). */
  rowFrom?: string | null;
  rowTo?: string | null;
  /** mm, when typed instead of the drawing's. */
  thickness?: number | null;
  /** The beams under the slab (on unless taken off). */
  beams?: boolean;
}
export interface OtherInput {
  what: string;
  m3: number | null;
  slump?: string;
}
export interface EstimateInput {
  kind: EstimateKind;
  columns?: ColumnsInput;
  slab?: SlabInput;
  other?: OtherInput;
  /** Per cent added before rounding up (spillage, the pump line, a little over). */
  extra: number;
}

/** Niko, 9 Nov 2026: columns take a high slump, around 20-22 cm; a slab around 15-17 cm. */
export const COLUMN_SLUMP = "20–22 cm";
export const SLAB_SLUMP = "15–17 cm";
export const EXTRA_CHOICES = [0, 5, 10] as const;
export const DEFAULT_EXTRA = 5;
/** A lift core's door is left out of the walls up to this height in each pour, mm. */
export const LIFT_DOOR_HEIGHT = 2100;
/** The tallest pour of columns that makes sense, m. */
export const MAX_HEIGHT = 6;

export interface EstimatePart {
  kind: "columns" | "slab" | "other";
  /** "1st floor columns", "2nd floor slab, grid H to N". */
  label: string;
  /** How it was worked out, line by line. */
  lines: string[];
  /** Worked out, m³ to one decimal. */
  m3: number;
  /** To order: with the extra, rounded up to a whole m³. */
  order: number;
  slump: string;
}
export interface EstimateResult {
  parts: EstimatePart[];
  m3: number;
  order: number;
  /** For "What's being poured". */
  what: string;
  /** Why it can't be worked out yet (nothing picked, no height...), or null. */
  problem: string | null;
}
/** A pour's estimate as saved with it. */
export interface SavedEstimate {
  input: EstimateInput;
  result: EstimateResult;
  at: string;
  by: string;
}

/* ---------- geometry ---------- */

const BIG = 1e7;
/** A beam on the slab's edge line still counts: points this close to the slab are on it, mm. */
const EDGE_TOLERANCE = 200;
const STEP = 25;

const round1 = (v: number) => Math.round(v * 10) / 10;
const m2 = (mm2: number) => mm2 / 1e6;
const m3of = (mm3: number) => mm3 / 1e9;
const fmt = (v: number, digits = 1) => v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Is the point inside the outline? (Even-odd rule.) */
export function inside(pt: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The outline cut down to a rectangle (Sutherland-Hodgman: a rectangle clips any outline, even an L-shaped one). */
export function clipToBox(poly: Point[], [x0, y0, x1, y1]: Box4): Point[] {
  const edges: Array<{ inside: (p: Point) => boolean; cut: (a: Point, b: Point) => Point }> = [
    { inside: (p) => p[0] >= x0, cut: (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= x1, cut: (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= y0, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0] },
    { inside: (p) => p[1] <= y1, cut: (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1] },
  ];
  let out = poly;
  for (const e of edges) {
    if (!out.length) break;
    const next: Point[] = [];
    for (let i = 0; i < out.length; i += 1) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      if (e.inside(b)) {
        if (!e.inside(a)) next.push(e.cut(a, b));
        next.push(b);
      } else if (e.inside(a)) next.push(e.cut(a, b));
    }
    out = next;
  }
  return out;
}

export function polyArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) s += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(s) / 2;
}

const posOf = (grid: EstGrid[], id: string | null | undefined): number | null => (id ? (grid.find((g) => g.id === id)?.pos ?? null) : null);

/**
 * From one grid line to another, as a range: the first and last lines reach out to the slab's edge (a pour "from B"
 * takes the cantilever past B). Null when a line isn't on this floor or both are the same line.
 */
export function rangeOf(grid: EstGrid[], from: string | null | undefined, to: string | null | undefined): [number, number] | null {
  if (!grid.length) return null;
  const sorted = [...grid].sort((a, b) => a.pos - b.pos);
  if (!from && !to) return [-BIG, BIG];
  let a = from ? posOf(grid, from) : sorted[0].pos;
  let b = to ? posOf(grid, to) : sorted[sorted.length - 1].pos;
  if (a === null || b === null || a === b) return null;
  if (a > b) [a, b] = [b, a];
  return [a <= sorted[0].pos ? -BIG : a, b >= sorted[sorted.length - 1].pos ? BIG : b];
}

/** In a range that ends at a grid line, the line itself belongs to the range after it (so two pours never share it). */
const within = (v: number, [lo, hi]: [number, number]) => v >= lo && (hi >= BIG ? v <= hi : v < hi);

/* ---------- columns ---------- */

function itemVolume(it: EstItem, h: number): { mm3: number; plan: number } {
  const [x0, y0, x1, y1] = it.box;
  const w = x1 - x0;
  const d = y1 - y0;
  if (it.kind === "lift" && it.wall) {
    const t = it.wall;
    const plan = w * d - Math.max(0, w - 2 * t) * Math.max(0, d - 2 * t);
    const door = it.door ? Math.min(it.door.width, it.door.side === "t" || it.door.side === "b" ? w : d) * t * Math.min(h, LIFT_DOOR_HEIGHT) : 0;
    return { mm3: plan * h - door, plan };
  }
  return { mm3: w * d * h, plan: w * d };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function columnsPart(floor: EstFloor, input: ColumnsInput): EstimatePart | string {
  const picked = floor.items.filter((i) => input.items.includes(i.id));
  if (!picked.length) return "Pick the columns to pour (tap them on the plan).";
  const height = input.height ?? 0;
  if (!(height > 0)) return "Type the height of this pour, in metres.";
  if (height > MAX_HEIGHT) return `A pour of columns ${MAX_HEIGHT} m high at most: type the height in metres, e.g. 3.0.`;
  const h = height * 1000;
  const groups: Array<{ kind: ItemKind; label: string }> = [
    { kind: "column", label: "column" },
    { kind: "wall", label: "wall" },
  ];
  const lines: string[] = [];
  let total = 0;
  for (const g of groups) {
    const these = picked.filter((i) => i.kind === g.kind);
    if (!these.length) continue;
    const sum = these.reduce((s, i) => s + itemVolume(i, h).mm3, 0);
    const plan = these.reduce((s, i) => s + itemVolume(i, h).plan, 0);
    total += sum;
    lines.push(`${plural(these.length, g.label)}: ${fmt(m2(plan), 2)} m² × ${fmt(height, 2)} m = ${fmt(m3of(sum))} m³`);
  }
  const lifts = picked.filter((i) => i.kind === "lift");
  if (lifts.length) {
    const sum = lifts.reduce((s, i) => s + itemVolume(i, h).mm3, 0);
    total += sum;
    const walls = [...new Set(lifts.map((l) => l.wall ?? 0))].join("/");
    const door = lifts.some((l) => l.door) ? `, less the door${lifts.length > 1 ? "s" : ""} (up to ${fmt(LIFT_DOOR_HEIGHT / 1000)} m high)` : "";
    lines.push(`${lifts.map((l) => l.name).join(", ")}: walls ${walls} mm${door} = ${fmt(m3of(sum))} m³`);
  }
  const counts = [
    picked.filter((i) => i.kind === "column").length ? plural(picked.filter((i) => i.kind === "column").length, "column") : "",
    picked.filter((i) => i.kind === "wall").length ? plural(picked.filter((i) => i.kind === "wall").length, "wall") : "",
    ...lifts.map((l) => l.name),
  ].filter(Boolean);
  const all = picked.length === floor.items.length;
  const label = `${floor.name} ${all || picked.some((i) => i.kind !== "lift") ? "columns" : "lift walls"}`;
  return {
    kind: "columns",
    label,
    lines: [`${all ? "All of them: " : ""}${counts.join(", ")}, ${fmt(height, 2)} m high`, ...lines],
    m3: round1(m3of(total)),
    order: 0,
    slump: COLUMN_SLUMP,
  };
}

/* ---------- a slab ---------- */

export interface SlabWork {
  /** m², the slab poured (openings left out). */
  area: number;
  /** m², the openings inside it. */
  openings: number;
  /** m³ of slab, and by thickness. */
  slab: number;
  byThickness: Array<{ t: number; area: number; m3: number }>;
  /** Metres of beam under it and their m³ below the slab. */
  beamLength: number;
  beams: number;
  /** The beams counted, for the plan: [x0, y0, x1, y1]. */
  beamLines: Box4[];
  /** The rectangle picked (for the plan), mm. */
  box: Box4;
}

function thicknessAt(x: number, zones: Array<{ range: [number, number]; t: number }>): number {
  return zones.find((z) => within(x, z.range))?.t ?? zones[zones.length - 1]?.t ?? 0;
}

/** The slab picked worked out: its area by thickness less the openings, and the beams under it. */
export function slabWork(floor: EstFloor, input: SlabInput): SlabWork | string {
  const outline = floor.outline;
  if (!outline || outline.length < 4) return `There's no slab outline for the ${floor.name.toLowerCase()} in the as-built record.`;
  const spec = slabSpecFor(floor.key);
  if (!spec) return `There's no slab drawing for the ${floor.name.toLowerCase()}.`;
  const xr = rangeOf(floor.xs, input.from, input.to);
  if (!xr) return "Pick two different grid lines: from one to the other.";
  const yr = input.rowFrom || input.rowTo ? rangeOf(floor.ys, input.rowFrom ?? null, input.rowTo ?? null) : ([-BIG, BIG] as [number, number]);
  if (!yr) return "Pick two different rows: from one to the other.";
  const typed = input.thickness && input.thickness > 0 ? input.thickness : null;
  const zones = spec.zones.map((z) => ({ range: [z.from ? (posOf(floor.xs, z.from) ?? -BIG) : -BIG, z.to ? (posOf(floor.xs, z.to) ?? BIG) : BIG] as [number, number], t: typed ?? z.t }));

  // The slab: the outline cut into cells at every corner, opening side, zone line and the range picked. A cell is in
  // or out as a whole, so the sums are exact for an outline and openings drawn square to the grid.
  const ox = outline.map((p) => p[0]);
  const oy = outline.map((p) => p[1]);
  const minX = Math.min(...ox);
  const maxX = Math.max(...ox);
  const minY = Math.min(...oy);
  const maxY = Math.max(...oy);
  const cutsX = new Set<number>(ox);
  const cutsY = new Set<number>(oy);
  for (const v of xr) cutsX.add(Math.min(maxX, Math.max(minX, v)));
  for (const v of yr) cutsY.add(Math.min(maxY, Math.max(minY, v)));
  for (const z of zones) for (const v of z.range) cutsX.add(Math.min(maxX, Math.max(minX, v)));
  for (const o of floor.openings) {
    cutsX.add(Math.min(maxX, Math.max(minX, o.box[0])));
    cutsX.add(Math.min(maxX, Math.max(minX, o.box[2])));
    cutsY.add(Math.min(maxY, Math.max(minY, o.box[1])));
    cutsY.add(Math.min(maxY, Math.max(minY, o.box[3])));
  }
  const xsCut = [...cutsX].sort((a, b) => a - b);
  const ysCut = [...cutsY].sort((a, b) => a - b);
  let area = 0;
  let holes = 0;
  const byT = new Map<number, number>();
  for (let i = 1; i < xsCut.length; i += 1) {
    const cx = (xsCut[i - 1] + xsCut[i]) / 2;
    const w = xsCut[i] - xsCut[i - 1];
    if (w <= 0 || !within(cx, xr)) continue;
    const t = thicknessAt(cx, zones);
    for (let j = 1; j < ysCut.length; j += 1) {
      const cy = (ysCut[j - 1] + ysCut[j]) / 2;
      const d = ysCut[j] - ysCut[j - 1];
      if (d <= 0 || !within(cy, yr) || !inside([cx, cy], outline)) continue;
      if (floor.openings.some((o) => cx > o.box[0] && cx < o.box[2] && cy > o.box[1] && cy < o.box[3])) {
        holes += w * d;
        continue;
      }
      area += w * d;
      byT.set(t, (byT.get(t) ?? 0) + w * d);
    }
  }
  const byThickness = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, a]) => ({ t, area: m2(a), m3: m3of(a * t) }));
  const slab = byThickness.reduce((s, z) => s + z.m3, 0);

  // The beams: each along its line, where the slab is (a point counts when it, or one just beside it, is on the slab).
  const onSlab = (p: Point, along: "row" | "line") =>
    inside(p, outline) ||
    (along === "row" ? inside([p[0], p[1] - EDGE_TOLERANCE], outline) || inside([p[0], p[1] + EDGE_TOLERANCE], outline) : inside([p[0] - EDGE_TOLERANCE, p[1]], outline) || inside([p[0] + EDGE_TOLERANCE, p[1]], outline));
  type Counted = { along: "row" | "line"; at: number; lo: number; hi: number; width: number; down: (v: number) => number; edge: boolean };
  const counted: Counted[] = [];
  const beamLines: Box4[] = [];
  let beamLength = 0;
  let beams = 0;
  if (input.beams !== false) {
    for (const b of spec.beams) {
      const across = b.along === "row" ? floor.ys : floor.xs;
      const alongGrid = b.along === "row" ? floor.xs : floor.ys;
      const at = typeof b.at === "number" ? b.at : posOf(across, b.at);
      const p = b.from === "edge" ? -BIG : posOf(alongGrid, b.from);
      const q = b.to === "edge" ? BIG : posOf(alongGrid, b.to);
      if (at === null || p === null || q === null) continue;
      const [lo0, hi0] = p <= q ? [p, q] : [q, p];
      // Picked by its position across: a row beam must be within the rows picked; a line beam within the lines.
      if (!within(at, b.along === "row" ? yr : xr)) continue;
      const span = b.along === "row" ? xr : yr;
      const lo = Math.max(lo0, span[0], b.along === "row" ? minX - EDGE_TOLERANCE : minY - EDGE_TOLERANCE);
      const hi = Math.min(hi0, span[1], b.along === "row" ? maxX + EDGE_TOLERANCE : maxY + EDGE_TOLERANCE);
      if (hi <= lo) continue;
      const down = (v: number) => Math.max(0, b.depth - (b.along === "row" ? thicknessAt(v, zones) : thicknessAt(at, zones)));
      let len = 0;
      let vol = 0;
      let runStart: number | null = null;
      const flush = (end: number) => {
        if (runStart === null) return;
        beamLines.push(b.along === "row" ? [runStart, at, end, at] : [at, runStart, at, end]);
        runStart = null;
      };
      if (b.edge) {
        // Along the edge: the whole span between its lines (the edge steps in and out with the balconies).
        len = hi - lo;
        for (let v = lo + STEP / 2; v < hi; v += STEP) vol += Math.min(STEP, hi - v + STEP / 2) * b.width * down(v);
        beamLines.push(b.along === "row" ? [lo, at, hi, at] : [at, lo, at, hi]);
      } else {
        for (let v = lo + STEP / 2; v < hi; v += STEP) {
          const pt: Point = b.along === "row" ? [v, at] : [at, v];
          if (onSlab(pt, b.along)) {
            const piece = Math.min(STEP, hi - (v - STEP / 2));
            len += piece;
            vol += piece * b.width * down(v);
            if (runStart === null) runStart = v - STEP / 2;
          } else flush(v - STEP / 2);
        }
        flush(hi);
      }
      if (len <= 0) continue;
      beamLength += len;
      beams += vol;
      counted.push({ along: b.along, at, lo, hi, width: b.width, down, edge: !!b.edge });
    }
    // Where a beam along a row crosses one down a line, the crossing is one piece of concrete, not two.
    for (const r of counted.filter((c) => c.along === "row" && !c.edge)) {
      for (const l of counted.filter((c) => c.along === "line" && !c.edge)) {
        if (l.at < r.lo || l.at > r.hi || r.at < l.lo || r.at > l.hi) continue;
        if (!onSlab([l.at, r.at], "row") && !onSlab([l.at, r.at], "line")) continue;
        beams -= r.width * l.width * Math.min(r.down(l.at), l.down(r.at));
      }
    }
  }
  const clampX = (v: number) => Math.min(maxX, Math.max(minX, v));
  const clampY = (v: number) => Math.min(maxY, Math.max(minY, v));
  return {
    area: m2(area),
    openings: m2(holes),
    slab,
    byThickness,
    beamLength: beamLength / 1000,
    beams: m3of(Math.max(0, beams)),
    beamLines,
    box: [clampX(xr[0]), clampY(yr[0]), clampX(xr[1]), clampY(yr[1])],
  };
}

function rangeWords(floor: EstFloor, input: SlabInput): string {
  const xs = [...floor.xs].sort((a, b) => a.pos - b.pos);
  const whole = (!input.from || input.from === xs[0]?.id) && (!input.to || input.to === xs[xs.length - 1]?.id);
  const across = whole ? "" : `grid ${input.from} to ${input.to}`;
  const rows = input.rowFrom && input.rowTo ? `rows ${input.rowFrom} to ${input.rowTo}` : "";
  return [across, rows].filter(Boolean).join(", ");
}

function slabPart(floor: EstFloor, input: SlabInput): EstimatePart | string {
  const work = slabWork(floor, input);
  if (typeof work === "string") return work;
  if (work.area <= 0) return "There's no slab between those grid lines.";
  const spec = slabSpecFor(floor.key)!;
  const typed = input.thickness && input.thickness > 0;
  const lines = [
    ...work.byThickness.map((z) => `Slab ${z.t} mm: ${fmt(z.area)} m² = ${fmt(z.m3)} m³`),
    ...(work.openings > 0.05 ? [`Openings left out: ${fmt(work.openings)} m² (voids, stairs, lift shafts)`] : []),
    ...(input.beams === false ? ["Beams under the slab: left out"] : work.beamLength > 0 ? [`Beams under the slab: ${fmt(work.beamLength, 0)} m = ${fmt(work.beams)} m³`] : []),
    typed ? `Thickness as typed; ${input.beams === false ? "" : "beams "}from ${spec.source}` : `From ${spec.source}`,
    ...(spec.borrowed ? [spec.borrowed] : []),
  ];
  const where = rangeWords(floor, input);
  return {
    kind: "slab",
    label: `${floor.name} slab${where ? `, ${where}` : ""}`,
    lines,
    m3: round1(work.slab + work.beams),
    order: 0,
    slump: SLAB_SLUMP,
  };
}

/* ---------- the whole estimate ---------- */

export function orderOf(m3: number, extra: number): number {
  if (!(m3 > 0)) return 0;
  return Math.max(1, Math.ceil(m3 * (1 + extra / 100) - 1e-6));
}

function floorOf(floors: EstFloor[], key: string | undefined): EstFloor | null {
  return floors.find((f) => f.key === key) ?? null;
}

/** "1st floor columns + 2nd floor slab, grid H to N", short enough for "What's being poured". */
function whatOf(parts: EstimatePart[]): string {
  const text = parts.map((p) => p.label).join(" + ");
  return text.length <= 80 ? text : text.replace(/, grid /g, " ").slice(0, 80);
}

export function estimate(input: EstimateInput, floors: EstFloor[]): EstimateResult {
  const extra = EXTRA_CHOICES.includes(input.extra as (typeof EXTRA_CHOICES)[number]) ? input.extra : DEFAULT_EXTRA;
  const parts: EstimatePart[] = [];
  let problem: string | null = null;
  const add = (part: EstimatePart | string) => {
    if (typeof part === "string") problem = problem ?? part;
    else parts.push({ ...part, order: orderOf(part.m3, extra) });
  };
  if (input.kind === "columns" || input.kind === "both") {
    const floor = floorOf(floors, input.columns?.floor);
    if (!floor || !input.columns) problem = problem ?? "Pick the floor the columns stand on.";
    else add(columnsPart(floor, input.columns));
  }
  if (input.kind === "slab" || input.kind === "both") {
    const floor = floorOf(floors, input.slab?.floor);
    if (!floor || !input.slab) problem = problem ?? "Pick the slab.";
    else add(slabPart(floor, input.slab));
  }
  if (input.kind === "other") {
    const o = input.other;
    if (!o?.what.trim()) problem = "Say what's being poured.";
    else if (!(o.m3 && o.m3 > 0)) problem = "Type the m³ (or work it out from its size).";
    else add({ kind: "other", label: o.what.trim(), lines: [], m3: round1(o.m3), order: 0, slump: o.slump?.trim() ?? "" });
  }
  const m3 = round1(parts.reduce((s, p) => s + p.m3, 0));
  return { parts, m3, order: parts.reduce((s, p) => s + p.order, 0), what: whatOf(parts), problem: parts.length ? problem : (problem ?? "Pick what's being poured.") };
}

/* ---------- the order for the concrete company ---------- */

export interface OrderLine {
  label: string;
  m3: number;
  slump: string;
}
export interface PourOrder {
  /** The concrete company. */
  supplier: string;
  /** Their WhatsApp number (blank: WhatsApp asks who to send it to). */
  phone: string;
  /** First truck on site, HH:MM. */
  time: string;
  pump: boolean;
  /** Who they call on site. */
  contact: string;
  notes: string;
  /** The strength ordered, as the pour has it ("35mpa", "C35"). */
  mix: string;
  lines: OrderLine[];
}
/** The order as last sent or copied. */
export interface SavedOrder extends PourOrder {
  sentAt: string;
  sentBy: string;
}

/** "35mpa" or "C35" as the concrete company writes it: "C35 (35 MPa)". */
export function strengthWords(mix: string): string {
  const t = mix.trim();
  if (!t) return "";
  const c = /^c\s*(\d{2})\s*$/i.exec(t);
  if (c) return `C${c[1]} (${c[1]} MPa)`;
  if (/^c\s*\d/i.test(t)) return t.toUpperCase().replace(/\s+/g, "");
  const n = /^(\d{2})\s*(mpa|n\/mm2|n\/mm²)?$/i.exec(t);
  return n ? `C${n[1]} (${n[1]} MPa)` : t;
}

/** "07:00" as "7:00 am". */
export function timeWords(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm.trim();
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

/** "Friday 13 November". */
export function longDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

const m3Words = (v: number) => `${Number.isInteger(v) ? v : fmt(v)} m³`;

/** The order as a short WhatsApp message. */
export function orderText(day: string, order: PourOrder): string {
  const lines = order.lines.filter((l) => l.m3 > 0);
  const total = lines.reduce((s, l) => s + l.m3, 0);
  const strength = strengthWords(order.mix);
  const out = [`Hello ${order.supplier.trim() || "there"}, a concrete order for The Lexington, please:`, ""];
  out.push(`*${longDay(day)}*${order.time ? `, first truck on site at ${timeWords(order.time)}` : ""}`);
  if (strength) out.push(`Strength: ${strength}`);
  for (const l of lines) out.push(`${l.label}: *${m3Words(l.m3)}*${l.slump.trim() ? `, slump ${l.slump.trim()}` : ""}`);
  if (lines.length > 1) out.push(`Total: *${m3Words(Math.round(total * 10) / 10)}*`);
  out.push(`Pump: ${order.pump ? "needed" : "not needed"}`);
  out.push(`Site: ${POSTAL_ADDRESS.streetAddress}, ${POSTAL_ADDRESS.addressLocality}`);
  if (order.contact.trim()) out.push(`On site: ${order.contact.trim()}`);
  if (order.notes.trim()) out.push("", order.notes.trim());
  out.push("", "Please confirm. Thank you.");
  return out.join("\n");
}

/** Opens WhatsApp with the message: to their number when it's known, else WhatsApp asks who to send it to. */
export function whatsappLink(phone: string, text: string): string {
  const digits = phone.trim() ? internationalDigits(phone) : "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** The order's lines from a booking: its estimate's parts, else one line for the whole pour. */
export function orderLines(what: string, volume: number | null, parts: EstimatePart[] | null | undefined): OrderLine[] {
  if (parts?.length) return parts.map((p) => ({ label: p.label, m3: p.order || p.m3, slump: p.slump }));
  const slump = /slab|beam|stair/i.test(what) ? SLAB_SLUMP : /column|wall|lift/i.test(what) ? COLUMN_SLUMP : "";
  return [{ label: what, m3: volume ?? 0, slump }];
}
