import { boxOf, gridLines, linePos, resolveFloor, slabCorners, type Box, type Point } from "@/lib/asbuilt/geometry";
import type { Axis, BoxEl, Floor } from "@/lib/asbuilt/types";

import {
  SPACE_TYPES,
  type Anchor,
  type PlanContent,
  type PlanPoint,
  type PlanReference,
  type SpaceLabel,
  type SpaceType,
  type WallKind,
} from "./types";

/**
 * Where everything on a floor plan is, and what it adds up to (Niko, 28 Oct 2026).
 *
 * Rooms are found from the walls: the floor (inside the slab edge) less the walls, columns, lift
 * cores and voids, cut into the pieces that don't touch. Because every wall runs along the grid,
 * this is exact: the floor is cut into rectangles at every wall face and column face, and a room is
 * the rectangles it is made of. Areas are measured to the faces of the walls.
 *
 * A home's net internal area follows the sale agreement (clause 1.1(r)): the floor inside the
 * internal face of its enclosing walls (its partitions count; a column standing free inside it
 * counts), not its balcony or terrace, not the shared areas.
 */

export type P = Point;

const r1 = (v: number) => Math.round(v * 10) / 10;
const EPS = 0.5;

// ---- what a coordinate hangs on ------------------------------------------------------------------

/** Where a reference is on the plan, as built: a grid line, a slab edge, or a face of a column or core. */
export function refPos(floor: Floor, axis: Axis, ref: string): number | null {
  if (ref.startsWith("e:")) {
    const edge = floor.slab?.edges.find((e) => e._key === ref.slice(2));
    if (!edge || edge.axis !== axis) return null;
    return resolveFloor(floor).edges.get(edge._key) ?? null;
  }
  if (ref.startsWith("c:")) {
    const [, list, key, face] = ref.split(":");
    if (list !== "columns" && list !== "cores") return null;
    const el = (floor[list] as BoxEl[]).find((e) => e._key === key);
    const b = el ? boxOf(floor, el, "actual") : null;
    if (!b) return null;
    // The middle: where a wall built onto the column is centred (it stays centred as the column is taped).
    if (face === "m") return axis === "x" ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2;
    if (axis === "x") return face === "l" ? b.x0 : face === "r" ? b.x1 : null;
    return face === "t" ? b.y0 : face === "b" ? b.y1 : null;
  }
  return linePos(floor, axis, ref, "actual");
}

export function anchorPos(floor: Floor, axis: Axis, a: Anchor): number | null {
  const at = refPos(floor, axis, a.ref);
  return at === null ? null : at + a.d;
}

export function pointPos(floor: Floor, p: PlanPoint): P | null {
  const x = anchorPos(floor, "x", p.x);
  const y = anchorPos(floor, "y", p.y);
  return x === null || y === null ? null : [x, y];
}

/** A position hung on the nearest grid line. */
export function hangOnGrid(floor: Floor, axis: Axis, v: number): Anchor {
  let best: { id: string; at: number } | null = null;
  for (const g of gridLines(floor, axis)) {
    const at = linePos(floor, axis, g.id, "actual");
    if (at === null) continue;
    if (!best || Math.abs(v - at) < Math.abs(v - best.at)) best = { id: g.id, at };
  }
  return best ? { ref: best.id, d: r1(v - best.at) } : { ref: axis === "x" ? "B" : "2", d: r1(v) };
}

/** The same reference, at a new position (a grid line instead when the reference is gone). */
export function reanchor(floor: Floor, axis: Axis, a: Anchor, v: number): Anchor {
  const at = refPos(floor, axis, a.ref);
  return at === null ? hangOnGrid(floor, axis, v) : { ref: a.ref, d: r1(v - at) };
}

/** In words: "grid K", "the slab edge", "C1 at K/7, left face". */
export function refName(floor: Floor, ref: string): string {
  if (ref.startsWith("e:")) return "the slab edge";
  if (ref.startsWith("c:")) {
    const [, list, key, face] = ref.split(":");
    const el = list === "columns" || list === "cores" ? (floor[list] as BoxEl[]).find((e) => e._key === key) : undefined;
    const faceWord = { l: "left face", r: "right face", t: "top face", b: "bottom face", m: "middle" }[face] ?? "face";
    if (!el) return "a column";
    return list === "cores" ? `${el.name}, ${faceWord}` : `${el.name} at ${el.x}/${el.y}, ${faceWord}`;
  }
  return `grid ${ref}`;
}

// ---- walls ---------------------------------------------------------------------------------------

export interface WallLine {
  key: string;
  kind: WallKind;
  t: number;
  /** "h": across the page; "v": down the page. */
  dir: "h" | "v";
  /** The centre line: y of an "h" wall, x of a "v" wall. */
  c: number;
  /** Its ends along it, s0 < s1. */
  s0: number;
  s1: number;
  /** The stored end a is the one at s0. */
  aFirst: boolean;
}

const sameAnchor = (p: Anchor, q: Anchor) => p.ref === q.ref && Math.abs(p.d - q.d) < 0.05;

/** Every wall as a straight line along the grid (a wall drawn a little off square is squared up). */
export function wallLines(floor: Floor, plan: Pick<PlanContent, "walls">): WallLine[] {
  const out: WallLine[] = [];
  for (const w of plan.walls) {
    const a = pointPos(floor, w.a);
    const b = pointPos(floor, w.b);
    if (!a || !b) continue;
    const horizontal = sameAnchor(w.a.y, w.b.y) || (!sameAnchor(w.a.x, w.b.x) && Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]));
    const [ca, sa, sb] = horizontal ? [a[1], a[0], b[0]] : [a[0], a[1], b[1]];
    if (Math.abs(sb - sa) < 1) continue;
    out.push({
      key: w._key,
      kind: w.kind,
      t: Math.max(10, w.t),
      dir: horizontal ? "h" : "v",
      c: ca,
      s0: Math.min(sa, sb),
      s1: Math.max(sa, sb),
      aFirst: sa <= sb,
    });
  }
  return out;
}

/** A wall's outline: its centre line widened by its thickness, carried on at an end that meets another wall. */
export function wallRect(w: WallLine, all: WallLine[]): Box {
  const meets = (s: number) =>
    all.some((o) => {
      if (o.key === w.key) return false;
      // The end sits on the other wall's centre line (a corner, a T, or a wall carrying straight on).
      if (o.dir === w.dir) return Math.abs(o.c - w.c) < EPS && s >= o.s0 - EPS && s <= o.s1 + EPS;
      return Math.abs(o.c - s) < EPS && w.c >= o.s0 - EPS && w.c <= o.s1 + EPS;
    });
  const h = w.t / 2;
  const e0 = meets(w.s0) ? h : 0;
  const e1 = meets(w.s1) ? h : 0;
  return w.dir === "h"
    ? { x0: w.s0 - e0, x1: w.s1 + e1, y0: w.c - h, y1: w.c + h }
    : { x0: w.c - h, x1: w.c + h, y0: w.s0 - e0, y1: w.s1 + e1 };
}

// ---- columns a wall is built onto --------------------------------------------------------------------

/**
 * A column a wall can be built onto (Niko, 4 Nov 2026: "have the walls snap to the obvious place to
 * connect to the column, in the middle of the column, so if the column is 30cm, and the wall will be
 * 15cm or 20cm, it will snap to the center of the column"): where it stands as built, and its middle
 * each way. A wall of the structure has no middle along its length: a wall meets its side where drawn.
 */
export interface ColumnSpot {
  key: string;
  /** "C1b M/7". */
  name: string;
  box: Box;
  mid: { x: number | null; y: number | null };
}

/** Longer than this one way, a column is a wall of the structure that way. */
const MIDDLE_MAX = 900;

export function columnSpots(floor: Floor): ColumnSpot[] {
  const out: ColumnSpot[] = [];
  for (const el of floor.columns) {
    const b = boxOf(floor, el, "actual");
    if (!b) continue;
    out.push({
      key: el._key,
      name: `${el.name} ${el.x}/${el.y}`,
      box: b,
      mid: { x: b.x1 - b.x0 <= MIDDLE_MAX ? (b.x0 + b.x1) / 2 : null, y: b.y1 - b.y0 <= MIDDLE_MAX ? (b.y0 + b.y1) / 2 : null },
    });
  }
  return out;
}

/** The column under a point, or within `within` mm of it (the one whose middle is nearest). */
export function columnAt(spots: ColumnSpot[], p: P, within: number): ColumnSpot | null {
  let best: ColumnSpot | null = null;
  let bestD = Infinity;
  for (const c of spots) {
    const { x0, x1, y0, y1 } = c.box;
    if (p[0] < x0 - within || p[0] > x1 + within || p[1] < y0 - within || p[1] > y1 + within) continue;
    const d = Math.hypot(p[0] - (x0 + x1) / 2, p[1] - (y0 + y1) / 2);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

export const columnAnchor = (c: ColumnSpot, face: "l" | "r" | "t" | "b" | "m"): Anchor => ({ ref: `c:columns:${c.key}:${face}`, d: 0 });

/** A line across a column that a wall built onto it sits on: its middle, or flush on one of its edges. */
export interface ColumnLine {
  v: number;
  anchor: Anchor;
  /** Goes before the column's name in the hint: "centred on", "on the top edge of". */
  how: string;
  edge: "l" | "r" | "t" | "b" | null;
}

/**
 * Where a wall `t` thick sits across a column (Niko, 12 Nov 2026: "I should be able to place them on the
 * edge between the columns in all directions"): centred on it, or with a face flush on either edge.
 * `axis` is the axis of the wall's centre line (x for a wall down the page), `v` where the hand is on it.
 * The nearest of the three wins. The edges only count once they are `apart` mm from the middle (far enough
 * to tell apart on screen), so zoomed out a wall is centred as before. A wall of the structure has no
 * middle along its length: there a wall is put flush only within its own thickness of an end.
 */
export function columnLineAt(c: ColumnSpot, axis: Axis, v: number, t: number, apart: number): ColumnLine | null {
  const [lo, hi] = axis === "x" ? [c.box.x0, c.box.x1] : [c.box.y0, c.box.y1];
  const mid = c.mid[axis];
  const [fLo, fHi] = axis === "x" ? (["l", "r"] as const) : (["t", "b"] as const);
  const word = { l: "left", r: "right", t: "top", b: "bottom" };
  const flush = (f: "l" | "r" | "t" | "b"): ColumnLine => {
    const low = f === fLo;
    return { v: low ? lo + t / 2 : hi - t / 2, anchor: { ref: `c:columns:${c.key}:${f}`, d: r1(low ? t / 2 : -t / 2) }, how: `on the ${word[f]} edge of`, edge: f };
  };
  if (mid === null) {
    if (hi - lo <= t) return null;
    if (v <= lo + t) return flush(fLo);
    if (v >= hi - t) return flush(fHi);
    return null;
  }
  const centred: ColumnLine = { v: mid, anchor: columnAnchor(c, "m"), how: "centred on", edge: null };
  const gap = (hi - lo - t) / 2; // from the middle line to a flush one
  if (gap < 10 || gap < apart) return centred;
  if (v < mid - gap / 2) return flush(fLo);
  if (v > mid + gap / 2) return flush(fHi);
  return centred;
}

/** A column's face on one side, along `axis`: the side `towards` is on (where the wall goes or comes from). */
export function columnFace(c: ColumnSpot, axis: Axis, towards: number): { v: number; anchor: Anchor } {
  const [lo, hi] = axis === "x" ? [c.box.x0, c.box.x1] : [c.box.y0, c.box.y1];
  const far = towards >= (lo + hi) / 2;
  return { v: far ? hi : lo, anchor: columnAnchor(c, axis === "x" ? (far ? "r" : "l") : far ? "b" : "t") };
}

/**
 * The column a wall's centre line falls on, to centre it there: `axis` is the axis of the centre
 * line (x for a wall down the page), `v` where it is now, s0 to s1 the wall's length, which must
 * reach the column.
 */
export function columnUnder(spots: ColumnSpot[], axis: Axis, v: number, s0: number, s1: number): ColumnSpot | null {
  let best: ColumnSpot | null = null;
  let bestD = Infinity;
  for (const c of spots) {
    const mid = c.mid[axis];
    if (mid === null) continue;
    const [lo, hi] = axis === "x" ? [c.box.x0, c.box.x1] : [c.box.y0, c.box.y1];
    const [alo, ahi] = axis === "x" ? [c.box.y0, c.box.y1] : [c.box.x0, c.box.x1];
    if (v < lo || v > hi || s1 < alo - EPS || s0 > ahi + EPS) continue;
    if (Math.abs(v - mid) < bestD) {
      best = c;
      bestD = Math.abs(v - mid);
    }
  }
  return best;
}

// ---- the floor cut into rectangles ------------------------------------------------------------------

/** What fills a rectangle of the floor. */
const FREE = 0;
const WALL = 1;
const COLUMN = 2;
const SOLID = 3; // lift cores and voids: never anyone's floor
const OUTSIDE = 4; // beyond the slab edge

interface Grid {
  xs: number[];
  ys: number[];
  nx: number;
  ny: number;
  fill: Uint8Array;
}

function uniqueSorted(values: number[]): number[] {
  const s = [...values.map((v) => Math.round(v * 10) / 10)].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > 0.05) out.push(v);
  return out;
}

/** Index of the last coordinate <= v. */
function cellIndex(coords: number[], v: number): number {
  let lo = 0;
  let hi = coords.length - 1;
  if (v < coords[0] || v >= coords[hi]) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (coords[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

function insidePolygon(pt: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Solid {
  box: Box;
  fill: number;
  /** A column or wall of the structure: its list and key. */
  id?: string;
}

function buildGrid(slab: P[] | null, solids: Solid[]): Grid {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of solids) {
    xs.push(s.box.x0, s.box.x1);
    ys.push(s.box.y0, s.box.y1);
  }
  for (const [x, y] of slab ?? []) {
    xs.push(x);
    ys.push(y);
  }
  const gx = uniqueSorted(xs);
  const gy = uniqueSorted(ys);
  const nx = Math.max(0, gx.length - 1);
  const ny = Math.max(0, gy.length - 1);
  const fill = new Uint8Array(nx * ny);
  // Beyond the slab edge first, then everything that stands on the floor (the stronger fill wins).
  if (slab) {
    for (let j = 0; j < ny; j += 1) {
      const cy = (gy[j] + gy[j + 1]) / 2;
      for (let i = 0; i < nx; i += 1) {
        if (!insidePolygon([(gx[i] + gx[i + 1]) / 2, cy], slab)) fill[j * nx + i] = OUTSIDE;
      }
    }
  }
  for (const s of solids) {
    // Its edges as the grid holds them (to 0.1 mm): an edge a hair off would fill the next rectangle too.
    const i0 = cellIndex(gx, r1(s.box.x0) + 0.01);
    const i1 = cellIndex(gx, r1(s.box.x1) - 0.01);
    const j0 = cellIndex(gy, r1(s.box.y0) + 0.01);
    const j1 = cellIndex(gy, r1(s.box.y1) - 0.01);
    if (i0 < 0 || i1 < 0 || j0 < 0 || j1 < 0) continue;
    for (let j = j0; j <= j1; j += 1)
      for (let i = i0; i <= i1; i += 1) {
        const k = j * nx + i;
        if (fill[k] !== OUTSIDE && s.fill > fill[k]) fill[k] = s.fill;
      }
  }
  return { xs: gx, ys: gy, nx, ny, fill };
}

interface Regions {
  /** Region of each rectangle, -1 where it isn't free floor. */
  of: Int32Array;
  count: number;
  area: number[];
  /** Touches the slab edge (beyond it is open air). */
  open: boolean[];
  /** The rectangles of each region. */
  cells: number[][];
}

function floodRegions(g: Grid): Regions {
  const of = new Int32Array(g.nx * g.ny).fill(-1);
  const area: number[] = [];
  const open: boolean[] = [];
  const cells: number[][] = [];
  const queue = new Int32Array(g.nx * g.ny);
  let count = 0;
  for (let start = 0; start < of.length; start += 1) {
    if (g.fill[start] !== FREE || of[start] !== -1) continue;
    const id = count;
    count += 1;
    let a = 0;
    let isOpen = false;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    of[start] = id;
    while (head < tail) {
      const k = queue[head++];
      const i = k % g.nx;
      const j = (k - i) / g.nx;
      a += (g.xs[i + 1] - g.xs[i]) * (g.ys[j + 1] - g.ys[j]);
      const next = [i > 0 ? k - 1 : -1, i < g.nx - 1 ? k + 1 : -1, j > 0 ? k - g.nx : -1, j < g.ny - 1 ? k + g.nx : -1];
      if (i === 0 || i === g.nx - 1 || j === 0 || j === g.ny - 1) isOpen = true;
      for (const n of next) {
        if (n < 0) continue;
        if (g.fill[n] === OUTSIDE) isOpen = true;
        if (g.fill[n] !== FREE || of[n] !== -1) continue;
        of[n] = id;
        queue[tail++] = n;
      }
    }
    area.push(a);
    open.push(isOpen);
    cells.push(Array.from(queue.subarray(0, tail)));
  }
  return { of, count, area, open, cells };
}

/** The outline of a region: loops of corners (outer edge and any holes), running round it. */
function regionLoops(g: Grid, of: Int32Array, id: number, cells: number[]): P[][] {
  // Edges between a rectangle of the region and one that isn't, kept with the region on the right.
  const next = new Map<string, P[]>();
  const key = (p: P) => `${p[0]},${p[1]}`;
  const add = (a: P, b: P) => {
    const k = key(a);
    const list = next.get(k);
    if (list) list.push(b);
    else next.set(k, [b]);
  };
  for (const k of cells) {
    {
      const i = k % g.nx;
      const j = (k - i) / g.nx;
      const x0 = g.xs[i];
      const x1 = g.xs[i + 1];
      const y0 = g.ys[j];
      const y1 = g.ys[j + 1];
      const inR = (ii: number, jj: number) => ii >= 0 && jj >= 0 && ii < g.nx && jj < g.ny && of[jj * g.nx + ii] === id;
      if (!inR(i, j - 1)) add([x0, y0], [x1, y0]);
      if (!inR(i + 1, j)) add([x1, y0], [x1, y1]);
      if (!inR(i, j + 1)) add([x1, y1], [x0, y1]);
      if (!inR(i - 1, j)) add([x0, y1], [x0, y0]);
    }
  }
  const loops: P[][] = [];
  for (const [startKey, ends] of next) {
    while (ends.length) {
      const loop: P[] = [startKey.split(",").map(Number) as P];
      let cur = ends.pop()!;
      let guard = 0;
      while (key(cur) !== startKey && guard < 1_000_000) {
        loop.push(cur);
        const outs = next.get(key(cur));
        if (!outs?.length) break;
        cur = outs.pop()!;
        guard += 1;
      }
      // Drop the corners where the outline carries straight on.
      const clean = loop.filter((p, n) => {
        const a = loop[(n - 1 + loop.length) % loop.length];
        const b = loop[(n + 1) % loop.length];
        return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
      });
      if (clean.length >= 4) loops.push(clean);
    }
  }
  return loops;
}

/** The rectangle under a point (or -1 off the floor). */
function cellAt(g: Grid, p: P): number {
  const i = cellIndex(g.xs, p[0]);
  const j = cellIndex(g.ys, p[1]);
  return i < 0 || j < 0 ? -1 : j * g.nx + i;
}

/** A good spot for a room's name: the middle of its biggest rectangle run. */
function labelSpot(g: Grid, of: Int32Array, id: number, cells: number[]): P {
  let best: { a: number; p: P } | null = null;
  let iMin = g.nx;
  let iMax = 0;
  let jMin = g.ny;
  let jMax = 0;
  for (const k of cells) {
    const ci = k % g.nx;
    const cj = (k - ci) / g.nx;
    iMin = Math.min(iMin, ci);
    iMax = Math.max(iMax, ci);
    jMin = Math.min(jMin, cj);
    jMax = Math.max(jMax, cj);
  }
  for (let j = jMin; j <= jMax; j += 1) {
    let i = iMin;
    while (i <= iMax) {
      if (of[j * g.nx + i] !== id) {
        i += 1;
        continue;
      }
      let e = i;
      while (e + 1 <= iMax && of[j * g.nx + e + 1] === id) e += 1;
      // Grow the run downwards while every rectangle below is in the room too.
      let f = j;
      const fits = (jj: number) => {
        for (let ii = i; ii <= e; ii += 1) if (of[jj * g.nx + ii] !== id) return false;
        return true;
      };
      while (f + 1 <= jMax && fits(f + 1)) f += 1;
      const w = g.xs[e + 1] - g.xs[i];
      const h = g.ys[f + 1] - g.ys[j];
      const a = Math.min(w, h * 2.2) * Math.min(h, w / 2.2);
      if (!best || a > best.a) best = { a, p: [(g.xs[i] + g.xs[e + 1]) / 2, (g.ys[j] + g.ys[f + 1]) / 2] };
      i = e + 1;
    }
  }
  return best?.p ?? [0, 0];
}

// ---- rooms and homes ---------------------------------------------------------------------------------

export const isOutdoor = (type: SpaceType | null | undefined) => SPACE_TYPES.some((s) => s.type === type && s.outdoor);
export const isCommon = (type: SpaceType | null | undefined) => SPACE_TYPES.some((s) => s.type === type && s.common);

export interface Room {
  id: number;
  /** m² to the faces of the walls. */
  area: number;
  loops: P[][];
  spot: P;
  /** Its extent, for fitting its name in. */
  box: Box;
  label: SpaceLabel | null;
  /** Reaches the slab edge with no wall in between. */
  open: boolean;
}

export interface Home {
  unit: string;
  /** Net internal area, m² (sale agreement 1.1(r)). */
  nia: number;
  /** Of which: columns standing free inside it, m². */
  columns: number;
  /** Balconies and terraces, m². */
  outdoor: number;
  rooms: Room[];
  /** The outline the net internal area is measured to (inside face of the enclosing walls). */
  loops: P[][];
}

export interface PlanAnalysis {
  walls: WallLine[];
  rooms: Room[];
  homes: Home[];
  /** Shared spaces (corridors, lobbies, stairs ...), m². */
  common: number;
  /** In words: anything that makes an area untrustworthy. */
  problems: { text: string; at?: P }[];
}

const m2 = (mm2: number) => Math.round(mm2 / 10_000) / 100;

/** Rooms, homes and their areas, for one floor plan on its as-built floor. */
export function analysePlan(floor: Floor, plan: Pick<PlanContent, "walls" | "labels">): PlanAnalysis {
  const walls = wallLines(floor, plan);
  const slab = slabCorners(floor, "actual");
  const structure: Solid[] = [];
  for (const list of ["columns", "cores"] as const) {
    for (const el of floor[list] as BoxEl[]) {
      const b = boxOf(floor, el, "actual");
      if (b) structure.push({ box: b, fill: list === "cores" ? SOLID : COLUMN, id: `${list}:${el._key}` });
    }
  }
  for (const el of floor.openings) {
    if (el.removed) continue;
    const b = boxOf(floor, el, "actual");
    if (b) structure.push({ box: b, fill: SOLID });
  }
  const wallSolids = walls.map((w) => ({ w, s: { box: wallRect(w, walls), fill: WALL } as Solid }));
  const problems: PlanAnalysis["problems"] = [];

  // Rooms: every wall closes.
  const g = buildGrid(slab, [...structure, ...wallSolids.map((x) => x.s)]);
  const reg = floodRegions(g);
  const labelsOf = new Map<number, SpaceLabel[]>();
  for (const label of plan.labels) {
    const p = pointPos(floor, label.at);
    const cell = p ? cellAt(g, p) : -1;
    const id = cell >= 0 ? reg.of[cell] : -1;
    if (id < 0) {
      problems.push({ text: `"${label.name || "A room"}" is pinned on a wall or off the floor: drag it into its room.`, at: p ?? undefined });
      continue;
    }
    labelsOf.set(id, [...(labelsOf.get(id) ?? []), label]);
  }
  const rooms: Room[] = [];
  for (let id = 0; id < reg.count; id += 1) {
    const labels = labelsOf.get(id) ?? [];
    if (labels.length > 1)
      problems.push({
        text: `${labels.map((l) => `"${l.name}"`).join(" and ")} are in one room: a wall between them is missing.`,
        at: pointPos(floor, labels[1].at) ?? undefined,
      });
    const loops = regionLoops(g, reg.of, id, reg.cells[id]);
    const pts = loops.flat();
    rooms.push({
      id,
      area: m2(reg.area[id]),
      loops,
      spot: labelSpot(g, reg.of, id, reg.cells[id]),
      box: {
        x0: Math.min(...pts.map((p) => p[0])),
        x1: Math.max(...pts.map((p) => p[0])),
        y0: Math.min(...pts.map((p) => p[1])),
        y1: Math.max(...pts.map((p) => p[1])),
      },
      label: labels[0] ?? null,
      open: reg.open[id],
    });
  }
  for (const room of rooms) {
    const l = room.label;
    if (l && room.open && !isOutdoor(l.type))
      problems.push({ text: `"${l.name}" reaches the slab edge with no wall: close it with an external wall or glazing.`, at: room.spot });
  }

  // Homes: the partitions inside a home don't count as its edge, so the home is one piece.
  const enclosing = wallSolids.filter((x) => x.w.kind !== "partition").map((x) => x.s);
  const g2 = buildGrid(slab, [...structure, ...enclosing]);
  const env = floodRegions(g2);
  const unitsOfEnvelope = new Map<number, Set<string>>();
  const roomsOfEnvelope = new Map<number, Room[]>();
  for (const room of rooms) {
    const cell = cellAt(g2, room.spot);
    const e = cell >= 0 ? env.of[cell] : -1;
    if (e < 0) continue;
    roomsOfEnvelope.set(e, [...(roomsOfEnvelope.get(e) ?? []), room]);
    const l = room.label;
    if (l?.unit && !isOutdoor(l.type) && !isCommon(l.type)) unitsOfEnvelope.set(e, new Set([...(unitsOfEnvelope.get(e) ?? []), l.unit]));
  }

  // Columns standing free inside a home count in its area (the area is measured to the enclosing walls).
  const freeColumns = (e: number) => {
    let a = 0;
    for (const s of structure) {
      if (s.fill !== COLUMN) continue;
      const ring: P[] = [];
      const { x0, x1, y0, y1 } = s.box;
      for (const t of [0.2, 0.5, 0.8]) {
        ring.push([x0 - 1, y0 + (y1 - y0) * t], [x1 + 1, y0 + (y1 - y0) * t], [x0 + (x1 - x0) * t, y0 - 1], [x0 + (x1 - x0) * t, y1 + 1]);
      }
      if (ring.every((p) => {
        const c = cellAt(g2, p);
        return c >= 0 && env.of[c] === e;
      }))
        a += (x1 - x0) * (y1 - y0);
    }
    return a;
  };

  const homes = new Map<string, Home>();
  for (let e = 0; e < env.count; e += 1) {
    const units = [...(unitsOfEnvelope.get(e) ?? [])];
    const inside = roomsOfEnvelope.get(e) ?? [];
    if (units.length > 1) {
      problems.push({
        text: `${units.join(" and ")} run into each other: make the wall between them "Between homes", not "Inside a home".`,
        at: inside[0]?.spot,
      });
      continue;
    }
    if (units.length !== 1) continue;
    const unit = units[0];
    const common = inside.filter((r) => isCommon(r.label?.type));
    if (common.length)
      problems.push({ text: `${unit} runs into "${common[0].label!.name}": make the wall between them "To the corridor".`, at: common[0].spot });
    const outdoorInside = inside.filter((r) => isOutdoor(r.label?.type));
    if (outdoorInside.length)
      problems.push({ text: `${unit}'s ${outdoorInside[0].label!.name.toLowerCase()} is joined to the home: make the wall between them glazing.`, at: outdoorInside[0].spot });
    const cols = freeColumns(e);
    const home = homes.get(unit) ?? { unit, nia: 0, columns: 0, outdoor: 0, rooms: [], loops: [] };
    home.nia = Math.round((home.nia + m2(env.area[e] + cols)) * 100) / 100;
    home.columns = Math.round((home.columns + m2(cols)) * 100) / 100;
    home.rooms.push(...inside.filter((r) => !isOutdoor(r.label?.type)));
    home.loops.push(...regionLoops(g2, env.of, e, env.cells[e]));
    homes.set(unit, home);
  }
  // Balconies and terraces of each home, from the rooms.
  for (const room of rooms) {
    const l = room.label;
    if (!l?.unit || !isOutdoor(l.type)) continue;
    const home = homes.get(l.unit) ?? { unit: l.unit, nia: 0, columns: 0, outdoor: 0, rooms: [], loops: [] };
    home.outdoor = Math.round((home.outdoor + room.area) * 100) / 100;
    home.rooms.push(room);
    homes.set(l.unit, home);
  }
  const common = rooms.filter((r) => isCommon(r.label?.type)).reduce((s, r) => s + r.area, 0);
  return {
    walls,
    rooms,
    homes: [...homes.values()].sort((a, b) => a.unit.localeCompare(b.unit, "en", { numeric: true })),
    common: Math.round(common * 100) / 100,
    problems,
  };
}

/** The difference from what the home is sold as, in percent (+ = bigger than stated). */
export function againstStated(nia: number, stated: number | null | undefined): number | null {
  return stated && stated > 0 ? Math.round(((nia - stated) / stated) * 1000) / 10 : null;
}

/** Sale agreement 2.4: up to 3% no change; 3-7% the price moves pro rata; over 7% less the buyer may rescind. */
export function toleranceBand(diffPct: number | null): "none" | "ok" | "adjust" | "rescind" {
  if (diffPct === null) return "none";
  const a = Math.abs(diffPct);
  if (a <= 3) return "ok";
  if (diffPct < -7) return "rescind";
  return "adjust";
}

// ---- an architect's plan underneath -----------------------------------------------------------------

export interface ReferenceStrip {
  /** Where the strip shows (mm), and where the whole picture is drawn for it (mm). */
  clip: Box;
  image: { x: number; y: number; w: number; h: number };
}

/** How the picture is laid: across, mm = a·pt + b; down, where it is pinned (true scale beyond). */
export interface ReferenceFit {
  /** On the as-built columns (its own columns matched to them), or on the grid lines. */
  on: "columns" | "grid";
  a: number;
  b: number;
  ys: { pt: number; mm: number }[];
}

type Pair = { pt: number; mm: number };

/** Least squares, mm = a·pt + b. */
function fitLine(pairs: Pair[]): { a: number; b: number } | null {
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((s, p) => s + p.pt, 0) / n;
  const my = pairs.reduce((s, p) => s + p.mm, 0) / n;
  const sxx = pairs.reduce((s, p) => s + (p.pt - mx) ** 2, 0);
  if (sxx < 1e-9) return null;
  const a = pairs.reduce((s, p) => s + (p.pt - mx) * (p.mm - my), 0) / sxx;
  return { a, b: my - a * mx };
}

/** The same, leaving out what sits well off the rest (a column the drawing has somewhere else). */
function fitKeeping(pairs: Pair[]): { a: number; b: number; keep: boolean[] } | null {
  let keep = pairs.map(() => true);
  let fit = fitLine(pairs);
  for (const tol of [150, 80]) {
    const f = fit;
    if (!f) return null;
    const next = pairs.map((p) => Math.abs(f.a * p.pt + f.b - p.mm) <= tol);
    if (next.filter(Boolean).length < Math.max(3, pairs.length / 2)) break;
    keep = next;
    fit = fitLine(pairs.filter((_, i) => next[i]));
  }
  return fit ? { ...fit, keep } : null;
}

const meanPair = (list: Pair[]): Pair => ({ pt: list.reduce((s, q) => s + q.pt, 0) / list.length, mm: list.reduce((s, q) => s + q.mm, 0) / list.length });

/**
 * Where an architect's plan goes on the as-built floor. On the columns where the drawing's own
 * columns are known (Niko, 4 Nov 2026: "Fix the columns from the as built measurements"): its
 * columns land on the columns as built, across with one scale for all of them, down with each row of
 * columns pinned where that row stands (the drawing's columns are not where its grid lines would put
 * them: laid on the grid lines, its row 7 columns came out 28 cm low). Otherwise on the grid lines:
 * across one scale fits all the lettered lines, down each band between two numbered lines is
 * stretched to fit the as-built rows. True scale beyond the last row.
 */
export function referenceFit(floor: Floor, ref: PlanReference): ReferenceFit | null {
  const pairs = (ref.cols ?? []).flatMap((c) => {
    const el = floor.columns.find((k) => `${k.x}/${k.y}` === c.at);
    const b = el ? boxOf(floor, el, "actual") : null;
    return el && b ? [{ row: el.y, x: { pt: c.x, mm: (b.x0 + b.x1) / 2 }, y: { pt: c.y, mm: (b.y0 + b.y1) / 2 } }] : [];
  });
  if (pairs.length >= 4) {
    const fx = fitKeeping(pairs.map((p) => p.x));
    const fy = fitKeeping(pairs.map((p) => p.y));
    if (fx && fy && fx.a > 0 && fy.a > 0) {
      // Each row of three or more columns is pinned where it stands, less any column of it the
      // drawing has somewhere else (well off the others in its row).
      const rows = new Map<string, Pair[]>();
      for (const p of pairs) rows.set(p.row, [...(rows.get(p.row) ?? []), p.y]);
      let ys = [...rows.values()]
        .filter((list) => list.length >= 3)
        .map((list) => {
          const off = list.map((q) => q.mm - fy.a * q.pt);
          const mid = [...off].sort((u, v) => u - v)[Math.floor(off.length / 2)];
          return list.filter((_, i) => Math.abs(off[i] - mid) <= 80);
        })
        .filter((list) => list.length >= 2)
        .map(meanPair)
        .sort((p, q) => p.pt - q.pt);
      // Rows that would fold the picture over give way to the one fit through all the columns.
      if (ys.length < 2 || ys.some((p, i) => i > 0 && (p.pt - ys[i - 1].pt < 1 || p.mm <= ys[i - 1].mm))) {
        const kept = pairs.filter((_, i) => fy.keep[i]).map((p) => p.y.pt);
        const lo = Math.min(...kept);
        const hi = Math.max(...kept);
        ys = (hi - lo >= 1 ? [lo, hi] : [lo]).map((pt) => ({ pt, mm: fy.a * pt + fy.b }));
      }
      return { on: "columns", a: fx.a, b: fx.b, ys };
    }
  }
  const xs = ref.xs
    .map((p) => ({ pt: p.pt, mm: linePos(floor, "x", p.line, "actual") }))
    .filter((p): p is Pair => p.mm !== null);
  const ys = ref.ys
    .map((p) => ({ pt: p.pt, mm: linePos(floor, "y", p.line, "actual") }))
    .filter((p): p is Pair => p.mm !== null)
    .sort((a, b) => a.pt - b.pt);
  const fx = fitLine(xs);
  return fx && ys.length ? { on: "grid", a: fx.a, b: fx.b, ys } : null;
}

/** The architect's plan cut into bands down the page, each drawn at its own scale (see referenceFit). */
export function referenceStrips(floor: Floor, ref: PlanReference): ReferenceStrip[] {
  const fit = referenceFit(floor, ref);
  if (!fit) return [];
  const { a, b, ys } = fit;
  const pageW = ref.w / ref.pxPerPt;
  const pageH = ref.h / ref.pxPerPt;
  const left = b;
  const right = b + a * pageW;
  const strips: ReferenceStrip[] = [];
  const band = (y0: number, y1: number, s: number, anchorMm: number, anchorPt: number) =>
    strips.push({
      clip: { x0: left, x1: right, y0: Math.min(y0, y1), y1: Math.max(y0, y1) },
      image: { x: b, y: anchorMm - s * anchorPt, w: a * pageW, h: s * pageH },
    });
  // Above the first row and below the last: true scale.
  band(ys[0].mm - a * ys[0].pt, ys[0].mm, a, ys[0].mm, ys[0].pt);
  for (let i = 1; i < ys.length; i += 1) {
    const s = (ys[i].mm - ys[i - 1].mm) / (ys[i].pt - ys[i - 1].pt);
    band(ys[i - 1].mm, ys[i].mm, s, ys[i - 1].mm, ys[i - 1].pt);
  }
  const last = ys[ys.length - 1];
  band(last.mm, last.mm + a * (pageH - last.pt), a, last.mm, last.pt);
  return strips;
}

// ---- snapping ---------------------------------------------------------------------------------------

export interface SnapLine {
  axis: Axis;
  v: number;
  anchor: Anchor;
  /** In words, for the hint while drawing. */
  what: string;
  /** Faces win over grid lines when both are as near. */
  rank: number;
}

/** Every line a wall can be lined up on: grid lines, slab edges, column and core faces, column middles, other walls. */
export function snapLines(floor: Floor, plan: Pick<PlanContent, "walls">, except?: string): SnapLine[] {
  const out: SnapLine[] = [];
  for (const axis of ["x", "y"] as const) {
    for (const g of gridLines(floor, axis)) {
      const v = linePos(floor, axis, g.id, "actual");
      if (v !== null) out.push({ axis, v, anchor: { ref: g.id, d: 0 }, what: `grid ${g.id}`, rank: 1 });
    }
  }
  for (const e of floor.slab?.edges ?? []) {
    const v = resolveFloor(floor).edges.get(e._key);
    if (v !== undefined) out.push({ axis: e.axis, v, anchor: { ref: `e:${e._key}`, d: 0 }, what: "slab edge", rank: 3 });
  }
  for (const list of ["columns", "cores"] as const) {
    for (const el of floor[list] as BoxEl[]) {
      const b = boxOf(floor, el, "actual");
      if (!b) continue;
      const name = list === "cores" ? el.name : `${el.name} ${el.x}/${el.y}`;
      out.push(
        { axis: "x", v: b.x0, anchor: { ref: `c:${list}:${el._key}:l`, d: 0 }, what: `${name} face`, rank: 3 },
        { axis: "x", v: b.x1, anchor: { ref: `c:${list}:${el._key}:r`, d: 0 }, what: `${name} face`, rank: 3 },
        { axis: "y", v: b.y0, anchor: { ref: `c:${list}:${el._key}:t`, d: 0 }, what: `${name} face`, rank: 3 },
        { axis: "y", v: b.y1, anchor: { ref: `c:${list}:${el._key}:b`, d: 0 }, what: `${name} face`, rank: 3 },
      );
    }
  }
  // The middle of each column, where a wall built onto it is centred.
  for (const c of columnSpots(floor)) {
    for (const axis of ["x", "y"] as const) {
      const v = c.mid[axis];
      if (v !== null) out.push({ axis, v, anchor: columnAnchor(c, "m"), what: `the middle of ${c.name}`, rank: 4 });
    }
  }
  // Other walls: their centre lines and faces, hung on whatever their centre line hangs on.
  for (const w of plan.walls) {
    if (w._key === except) continue;
    const line = wallLines(floor, { walls: [w] })[0];
    if (!line) continue;
    const axis: Axis = line.dir === "h" ? "y" : "x";
    const base = line.dir === "h" ? w.a.y : w.a.x;
    for (const off of [0, -line.t / 2, line.t / 2])
      out.push({ axis, v: line.c + off, anchor: { ref: base.ref, d: r1(base.d + off) }, what: off ? "wall face" : "wall centre", rank: off ? 2 : 1 });
    // Its ends, across.
    const other: Axis = axis === "x" ? "y" : "x";
    const ends = line.aFirst ? [w.a, w.b] : [w.b, w.a];
    out.push(
      { axis: other, v: line.s0, anchor: { ...(other === "x" ? ends[0].x : ends[0].y) }, what: "wall end", rank: 2 },
      { axis: other, v: line.s1, anchor: { ...(other === "x" ? ends[1].x : ends[1].y) }, what: "wall end", rank: 2 },
    );
  }
  return out;
}

/** Where two lines fall in the same place, which one a wall is hung on: the grid first (it is what is set out from). */
const tiePriority = (l: SnapLine) => (l.anchor.ref.startsWith("c:") ? 3 : l.anchor.ref.startsWith("e:") ? 2 : /^[A-Za-z0-9]{1,6}$/.test(l.anchor.ref) && l.what.startsWith("grid") ? 4 : 1);

/** The line nearest to v within `reach` mm, shifted by `offset` (a face of the wall drawn): what is pointed at. */
export function snapTo(lines: SnapLine[], axis: Axis, v: number, reach: number, offset = 0): SnapLine | null {
  let best: SnapLine | null = null;
  let bestD = Infinity;
  for (const l of lines) {
    if (l.axis !== axis) continue;
    const d = Math.abs(l.v + offset - v);
    if (d <= reach && (d < bestD - 0.5 || (Math.abs(d - bestD) <= 0.5 && best && l.rank > best.rank))) {
      best = l;
      bestD = d;
    }
  }
  if (!best) return null;
  // Lines in the very same place: hang on the grid line rather than a slab edge or a wall there.
  const chosen = lines
    .filter((l) => l.axis === axis && Math.abs(l.v - best!.v) < 0.5)
    .sort((a, b) => tiePriority(b) - tiePriority(a))[0];
  return { ...chosen, v: chosen.v + offset, anchor: { ref: chosen.anchor.ref, d: r1(chosen.anchor.d + offset) } };
}
