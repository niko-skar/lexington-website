import type { Axis, BoxEl, BoxList, ColumnEl, CoreFaces, Faces, Floor, GridLine, SlabEdge, Tolerance } from "./types";

/** "design" = the drawing; "actual" = as built where measured, the drawing elsewhere. */
export type Mode = "design" | "actual";

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export type Point = [number, number];

// ---- grid ------------------------------------------------------------------

export function gridLines(floor: Floor, axis: Axis): GridLine[] {
  return floor.grid.filter((g) => g.axis === axis).sort((a, b) => a.design - b.design);
}

export function lineOf(floor: Floor, axis: Axis, id: string): GridLine | undefined {
  return floor.grid.find((g) => g.axis === axis && g.id === id);
}

export function linePos(floor: Floor, axis: Axis, id: string, mode: Mode): number | null {
  const line = lineOf(floor, axis, id);
  if (!line) return null;
  return line.design + (mode === "actual" ? (line.shift ?? 0) : 0);
}

export interface Gap {
  from: GridLine;
  to: GridLine;
  design: number;
  actual: number;
  measured: boolean;
}

/** The spacing between each pair of neighbouring grid lines on one axis. */
export function gapsOf(floor: Floor, axis: Axis): Gap[] {
  const lines = gridLines(floor, axis);
  const out: Gap[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const from = lines[i - 1];
    const to = lines[i];
    out.push({
      from,
      to,
      design: to.design - from.design,
      actual: to.design + (to.shift ?? 0) - (from.design + (from.shift ?? 0)),
      measured: to.measured === true,
    });
  }
  return out;
}

/**
 * Changing one gap moves that line and every line after it by the same amount,
 * so every other gap stays as it was. Returns the new shift of each moved line.
 */
export function shiftsForGap(
  floor: Floor,
  axis: Axis,
  toId: string,
  newGap: number,
): { id: string; key: string; shift: number }[] {
  const gap = gapsOf(floor, axis).find((g) => g.to.id === toId);
  if (!gap) return [];
  const delta = newGap - gap.actual;
  const lines = gridLines(floor, axis);
  const start = lines.findIndex((l) => l.id === toId);
  return lines.slice(start).map((l) => ({ id: l.id, key: l._key, shift: round1((l.shift ?? 0) + delta) }));
}

// ---- boxes (columns, walls, lift cores, openings) ------------------------------

export function facesOf(el: BoxEl, mode: Mode): Faces | CoreFaces | null {
  if (mode === "design") return el.design;
  return el.actual ?? el.design;
}

export function boxFromFaces(floor: Floor, el: { x: string; y: string }, faces: Faces, mode: Mode): Box | null {
  const fx = linePos(floor, "x", el.x, mode);
  const fy = linePos(floor, "y", el.y, mode);
  if (fx === null || fy === null) return null;
  return { x0: fx + faces.l, x1: fx + faces.r, y0: fy + faces.t, y1: fy + faces.b };
}

export function boxOf(floor: Floor, el: BoxEl, mode: Mode): Box | null {
  const faces = facesOf(el, mode);
  return faces ? boxFromFaces(floor, el, faces, mode) : null;
}

export function centreOf(box: Box): Point {
  return [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
}

export function isMeasured(el: { actual?: unknown }): boolean {
  return el.actual !== null && el.actual !== undefined;
}

export interface Deviation {
  /** Centre moved right (+) or left (-) of the drawing, mm. */
  dx: number;
  /** Centre moved down (+) or up (-) the page, mm. */
  dy: number;
  /** Width and depth as built less the drawing. */
  dw: number;
  dh: number;
  /** The face furthest from where the drawing puts it, mm. */
  worst: number;
}

export function deviationOf(floor: Floor, el: BoxEl): Deviation | null {
  if (!isMeasured(el) || !el.design) return null;
  const d = boxOf(floor, el, "design");
  const a = boxOf(floor, el, "actual");
  if (!d || !a) return null;
  const [dcx, dcy] = centreOf(d);
  const [acx, acy] = centreOf(a);
  return {
    dx: round1(acx - dcx),
    dy: round1(acy - dcy),
    dw: round1(a.x1 - a.x0 - (d.x1 - d.x0)),
    dh: round1(a.y1 - a.y0 - (d.y1 - d.y0)),
    worst: round1(Math.max(Math.abs(a.x0 - d.x0), Math.abs(a.x1 - d.x1), Math.abs(a.y0 - d.y0), Math.abs(a.y1 - d.y1))),
  };
}

export type Status = "none" | "ok" | "warn" | "off" | "new";

export function statusFor(worst: number | null, tol: Tolerance): Status {
  if (worst === null) return "none";
  if (worst <= tol.ok) return "ok";
  if (worst <= tol.warn) return "warn";
  return "off";
}

export function boxStatus(floor: Floor, el: BoxEl, tol: Tolerance): Status {
  if (!isMeasured(el)) return "none";
  if (!el.design) return "new";
  return statusFor(deviationOf(floor, el)?.worst ?? null, tol);
}

// ---- slab edges ----------------------------------------------------------------

export function edgePos(floor: Floor, edge: SlabEdge, mode: Mode): number | null {
  const line = linePos(floor, edge.axis, edge.ref, mode);
  if (line === null) return null;
  return line + (mode === "actual" ? (edge.actual ?? edge.design) : edge.design);
}

/**
 * The slab outline. Edges alternate across and down the page, so corner i is
 * where edge i meets edge i + 1. Edge i runs from corner i - 1 to corner i.
 */
export function slabCorners(floor: Floor, mode: Mode): Point[] | null {
  const edges = floor.slab?.edges;
  if (!edges || edges.length < 4) return null;
  const pts: Point[] = [];
  for (let i = 0; i < edges.length; i += 1) {
    const a = edges[i];
    const b = edges[(i + 1) % edges.length];
    if (a.axis === b.axis) return null;
    const pa = edgePos(floor, a, mode);
    const pb = edgePos(floor, b, mode);
    if (pa === null || pb === null) return null;
    pts.push(a.axis === "x" ? [pa, pb] : [pb, pa]);
  }
  return pts;
}

export function edgeSegment(corners: Point[], index: number): [Point, Point] {
  const n = corners.length;
  return [corners[(index - 1 + n) % n], corners[index]];
}

export function edgeDeviation(floor: Floor, edge: SlabEdge): number | null {
  if (edge.actual === null || edge.actual === undefined) return null;
  const a = edgePos(floor, edge, "actual");
  const d = edgePos(floor, edge, "design");
  return a === null || d === null ? null : round1(a - d);
}

// ---- neighbours along the grid ---------------------------------------------------

export interface Neighbour {
  el: ColumnEl;
  /** Which side of the column it is on. */
  side: "left" | "right" | "up" | "down";
  /** Centre to centre, as things stand (as built where measured). */
  actual: number;
  design: number;
}

/** The nearest column or wall on each side, along this column's own grid lines. */
export function neighboursOf(floor: Floor, el: ColumnEl): Neighbour[] {
  const me = boxOf(floor, el, "actual");
  const meD = boxOf(floor, el, "design");
  if (!me || !meD) return [];
  const [mx, my] = centreOf(me);
  const [dmx, dmy] = centreOf(meD);
  const out: Neighbour[] = [];
  const pick = (side: Neighbour["side"], candidates: ColumnEl[], axis: 0 | 1, sign: 1 | -1) => {
    let best: Neighbour | null = null;
    for (const c of candidates) {
      if (c._key === el._key) continue;
      const b = boxOf(floor, c, "actual");
      const bd = boxOf(floor, c, "design");
      if (!b || !bd) continue;
      const along = (centreOf(b)[axis] - (axis === 0 ? mx : my)) * sign;
      if (along <= 0) continue;
      if (!best || along < best.actual) {
        best = {
          el: c,
          side,
          actual: round1(along),
          design: round1((centreOf(bd)[axis] - (axis === 0 ? dmx : dmy)) * sign),
        };
      }
    }
    if (best) out.push(best);
  };
  const row = floor.columns.filter((c) => c.y === el.y);
  const col = floor.columns.filter((c) => c.x === el.x);
  pick("left", row, 0, -1);
  pick("right", row, 0, 1);
  pick("up", col, 1, -1);
  pick("down", col, 1, 1);
  return out;
}

// ---- whole floor -------------------------------------------------------------------

export function allBoxes(floor: Floor): { list: BoxList; el: BoxEl }[] {
  return [
    ...floor.openings.map((el) => ({ list: "openings" as const, el })),
    ...floor.cores.map((el) => ({ list: "cores" as const, el })),
    ...floor.columns.map((el) => ({ list: "columns" as const, el })),
  ];
}

/** Everything drawn on the floor, for fitting it on screen. */
export function extentsOf(floor: Floor): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const g of floor.grid) (g.axis === "x" ? xs : ys).push(g.design + (g.shift ?? 0));
  for (const [x, y] of slabCorners(floor, "actual") ?? []) {
    xs.push(x);
    ys.push(y);
  }
  for (const { el } of allBoxes(floor)) {
    const b = boxOf(floor, el, "actual");
    if (b) {
      xs.push(b.x0, b.x1);
      ys.push(b.y0, b.y1);
    }
  }
  if (!xs.length || !ys.length) return { x0: 0, x1: 50000, y0: 0, y1: 20000 };
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Which list an element sits in, for the change paths. */
export function findBox(floor: Floor, list: BoxList, key: string): BoxEl | undefined {
  return (floor[list] as BoxEl[]).find((e) => e._key === key);
}
