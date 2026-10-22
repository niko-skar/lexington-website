import type {
  Axis,
  BoxEl,
  BoxList,
  ColumnEl,
  CoreEl,
  CoreFaces,
  Faces,
  Floor,
  GridLine,
  OpeningEl,
  SlabEdge,
  TapeMeasures,
  Tolerance,
} from "./types";

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
  if (mode === "actual") {
    const list = tapeListOf(el);
    if (list) {
      const resolved = resolvedBoxes(floor).get(`${list}:${el._key}`);
      return resolved ? { ...resolved } : null;
    }
  }
  const faces = facesOf(el, mode);
  return faces ? boxFromFaces(floor, el, faces, mode) : null;
}

// ---- taped on site: sizes and the gaps between columns ------------------------------

export type TapeList = "columns" | "cores";
export type TapeEl = ColumnEl | CoreEl;
export interface TapeItem {
  list: TapeList;
  el: TapeEl;
}

/** Columns and walls (kind column/wall) and lift cores (with a wall thickness) are taped; openings are not. */
export function tapeListOf(el: BoxEl): TapeList | null {
  if ("kind" in el && (el.kind === "column" || el.kind === "wall")) return "columns";
  if (el.design && "wall" in el.design) return "cores";
  return null;
}

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;

/**
 * A lift core with nothing else on its own grid line is measured along the next grid line through it that has columns on
 * it. Lift 2 is set out from line J, where nothing else stands, but the columns above and below it (K/3 and K/7) stand on
 * line K, so down line K the tape runs K/3, Lift 2, K/7, the way it runs D/3, Lift 1, D/7 down line D. Returns that line,
 * or null when the core is measured along its own line. axis "x": rows (numbered lines); axis "y": lettered lines.
 */
export function adoptedLine(floor: Floor, axis: Axis, core: CoreEl): string | null {
  const own = axis === "x" ? core.y : core.x;
  const standsOn = (id: string) =>
    floor.columns.some((c) => (axis === "x" ? c.y : c.x) === id) ||
    floor.cores.some((c) => c._key !== core._key && (axis === "x" ? c.y : c.x) === id);
  if (standsOn(own)) return null;
  const b = boxFromFaces(floor, core, core.design, "design");
  if (!b) return null;
  const [lo, hi] = axis === "x" ? [b.y0, b.y1] : [b.x0, b.x1];
  const through = gridLines(floor, axis === "x" ? "y" : "x").find(
    (g) => g.id !== own && g.design > lo && g.design < hi && standsOn(g.id),
  );
  return through ? through.id : null;
}

/** The grid line an item is taped along: its own, or for a lift core on its own line, the line through it (see adoptedLine). */
export function chainLineOf(floor: Floor, axis: Axis, it: TapeItem): string {
  if (it.list === "cores") {
    const adopted = adoptedLine(floor, axis, it.el as CoreEl);
    if (adopted) return adopted;
  }
  return axis === "x" ? it.el.y : it.el.x;
}

/**
 * Columns, walls and lift cores standing on one grid line, in order along it.
 * axis "x": the row on numbered line `lineId` (B, C, D ... left to right);
 * axis "y": the line down lettered line `lineId` (2, 3, 4 ... top to bottom).
 */
export function chainOf(floor: Floor, axis: Axis, lineId: string): TapeItem[] {
  const items: TapeItem[] = [
    ...floor.columns.map((el) => ({ list: "columns" as const, el })),
    ...floor.cores.map((el) => ({ list: "cores" as const, el })),
  ].filter((it) => chainLineOf(floor, axis, it) === lineId);
  const at = (it: TapeItem) => {
    const b = boxFromFaces(floor, it.el, it.el.design, "design");
    return b ? centreOf(b)[axis === "x" ? 0 : 1] : 0;
  };
  return items.sort((a, b) => at(a) - at(b));
}

/** The lines with two or more things standing on them, so there is a gap to tape. */
export function chainLines(floor: Floor, axis: Axis): string[] {
  const lines = gridLines(floor, axis === "x" ? "y" : "x");
  return lines.map((l) => l.id).filter((id) => chainOf(floor, axis, id).length >= 2);
}

const resolvedCache = new WeakMap<Floor, Map<string, Box>>();

/**
 * Where every column, wall and lift core really is. Start from the grid lines (the
 * faces measured from them, or the drawing), give each its measured size, then walk
 * along each row and down each line: a column with a measured gap sits that gap past
 * the one before it, so changing one gap carries on to the columns after it.
 */
export function resolvedBoxes(floor: Floor): Map<string, Box> {
  const cached = resolvedCache.get(floor);
  if (cached) return cached;
  const boxes = new Map<string, Box>();
  const lists: TapeList[] = ["columns", "cores"];
  for (const list of lists) {
    for (const el of floor[list] as TapeEl[]) {
      const b = boxFromFaces(floor, el, el.actual ?? el.design, "actual");
      if (!b) continue;
      const [cx, cy] = centreOf(b);
      if (has(el.w)) {
        b.x0 = cx - el.w / 2;
        b.x1 = cx + el.w / 2;
      }
      if (has(el.h)) {
        b.y0 = cy - el.h / 2;
        b.y1 = cy + el.h / 2;
      }
      boxes.set(`${list}:${el._key}`, b);
    }
  }
  for (const axis of ["x", "y"] as const) {
    for (const lineId of chainLines(floor, axis)) {
      const chain = chainOf(floor, axis, lineId);
      for (let i = 1; i < chain.length; i += 1) {
        const gap = axis === "x" ? chain[i].el.gx : chain[i].el.gy;
        if (!has(gap)) continue;
        const prev = boxes.get(`${chain[i - 1].list}:${chain[i - 1].el._key}`);
        const cur = boxes.get(`${chain[i].list}:${chain[i].el._key}`);
        if (!prev || !cur) continue;
        if (axis === "x") {
          const w = cur.x1 - cur.x0;
          cur.x0 = prev.x1 + gap;
          cur.x1 = cur.x0 + w;
        } else {
          const h = cur.y1 - cur.y0;
          cur.y0 = prev.y1 + gap;
          cur.y1 = cur.y0 + h;
        }
      }
    }
  }
  resolvedCache.set(floor, boxes);
  return boxes;
}

export interface TapeGap {
  axis: Axis;
  prev: TapeItem;
  next: TapeItem;
  /** Clear gap, face to face, on the drawing. */
  design: number;
  /** Clear gap as things stand (as built where measured). */
  actual: number;
  /** Centre to centre, as things stand and on the drawing. */
  cc: number;
  ccDesign: number;
  /** The gap itself was taped (it is stored on `next`). */
  measured: boolean;
}

/** Every gap along one row (axis x) or down one line (axis y). */
export function tapeGaps(floor: Floor, axis: Axis, lineId: string): TapeGap[] {
  const chain = chainOf(floor, axis, lineId);
  const out: TapeGap[] = [];
  const lo = axis === "x" ? "x0" : "y0";
  const hi = axis === "x" ? "x1" : "y1";
  const c = axis === "x" ? 0 : 1;
  for (let i = 1; i < chain.length; i += 1) {
    const prev = chain[i - 1];
    const next = chain[i];
    const pa = boxOf(floor, prev.el, "actual");
    const na = boxOf(floor, next.el, "actual");
    const pd = boxOf(floor, prev.el, "design");
    const nd = boxOf(floor, next.el, "design");
    if (!pa || !na || !pd || !nd) continue;
    out.push({
      axis,
      prev,
      next,
      design: round1(nd[lo] - pd[hi]),
      actual: round1(na[lo] - pa[hi]),
      cc: round1(centreOf(na)[c] - centreOf(pa)[c]),
      ccDesign: round1(centreOf(nd)[c] - centreOf(pd)[c]),
      measured: has(axis === "x" ? next.el.gx : next.el.gy),
    });
  }
  return out;
}

/** The gaps on either side of one column: along its row (x) and down its line (y). */
export function gapsAround(floor: Floor, el: TapeEl): { axis: Axis; before?: TapeGap; after?: TapeGap }[] {
  const list: TapeList = tapeListOf(el) ?? "columns";
  return (["x", "y"] as const).map((axis) => {
    const gaps = tapeGaps(floor, axis, chainLineOf(floor, axis, { list, el }));
    return {
      axis,
      before: gaps.find((g) => g.next.el._key === el._key),
      after: gaps.find((g) => g.prev.el._key === el._key),
    };
  });
}

/** Width (x) and depth (y) as things stand, and on the drawing. */
export function sizeOf(floor: Floor, el: TapeEl): { w: number; h: number; dw: number; dh: number } | null {
  const a = boxOf(floor, el, "actual");
  const d = boxOf(floor, el, "design");
  if (!a || !d) return null;
  return { w: round1(a.x1 - a.x0), h: round1(a.y1 - a.y0), dw: round1(d.x1 - d.x0), dh: round1(d.y1 - d.y0) };
}

export function centreOf(box: Box): Point {
  return [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
}

/** Anything measured on this item: its faces from the grid, its size, or the gap to it. */
export function isMeasured(el: { actual?: unknown } & TapeMeasures): boolean {
  return (el.actual !== null && el.actual !== undefined) || has(el.w) || has(el.h) || has(el.gx) || has(el.gy);
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

/** Is the point inside the slab outline? (Even-odd rule.) */
export function insideOutline(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface EdgeReach {
  edge: SlabEdge;
  item: TapeItem;
  /** The face of the column that looks at the edge. */
  face: "l" | "r" | "t" | "b";
  /** Where the face and the edge are (mm across or down the page), and where along them the dimension sits. */
  from: number;
  to: number;
  at: number;
  /** Face to edge, as things stand and on the drawing. */
  distance: number;
  design: number | null;
}

/**
 * How far each slab edge is from the columns in front of it: for every edge, the
 * columns and walls facing it within 3 m, inside the slab, with nothing in between.
 */
export function edgeReaches(floor: Floor, maxReach = 3000): EdgeReach[] {
  const corners = slabCorners(floor, "actual");
  const designCorners = slabCorners(floor, "design");
  if (!corners || !floor.slab) return [];
  const items: { it: TapeItem; b: Box; d: Box | null }[] = [];
  for (const list of ["columns", "cores"] as const) {
    for (const el of floor[list] as TapeEl[]) {
      const b = boxOf(floor, el, "actual");
      if (b) items.push({ it: { list, el }, b, d: boxOf(floor, el, "design") });
    }
  }
  const out: EdgeReach[] = [];
  floor.slab.edges.forEach((edge, i) => {
    const [p, q] = edgeSegment(corners, i);
    const across = edge.axis === "y";
    // A horizontal edge (axis y) sits at one y and runs across; a vertical one sits at one x.
    const pos = across ? p[1] : p[0];
    const lo = Math.min(across ? p[0] : p[1], across ? q[0] : q[1]);
    const hi = Math.max(across ? p[0] : p[1], across ? q[0] : q[1]);
    const designPos = designCorners
      ? across
        ? edgeSegment(designCorners, i)[0][1]
        : edgeSegment(designCorners, i)[0][0]
      : null;
    for (const { it, b, d } of items) {
      const [cx, cy] = centreOf(b);
      const along = across ? cx : cy;
      if (along < lo || along > hi) continue;
      if (!insideOutline([cx, cy], corners)) continue;
      const near = across ? b.y0 : b.x0;
      const far = across ? b.y1 : b.x1;
      let face: EdgeReach["face"];
      let from: number;
      if (pos <= near) {
        face = across ? "t" : "l";
        from = near;
      } else if (pos >= far) {
        face = across ? "b" : "r";
        from = far;
      } else continue;
      const distance = Math.abs(pos - from);
      if (distance < 1 || distance > maxReach) continue;
      // Nothing standing between this column and the edge.
      const blocked = items.some(({ it: o, b: ob }) => {
        if (o.el._key === it.el._key && o.list === it.list) return false;
        const oAlongLo = across ? ob.x0 : ob.y0;
        const oAlongHi = across ? ob.x1 : ob.y1;
        if (along < oAlongLo || along > oAlongHi) return false;
        const oNear = across ? ob.y0 : ob.x0;
        const oFar = across ? ob.y1 : ob.x1;
        return from > pos ? oFar <= from && oNear >= pos : oNear >= from && oFar <= pos;
      });
      if (blocked) continue;
      let design: number | null = null;
      if (d && designPos !== null) {
        const dFace = face === "t" ? d.y0 : face === "b" ? d.y1 : face === "l" ? d.x0 : d.x1;
        design = round1(Math.abs(designPos - dFace));
      }
      out.push({ edge, item: it, face, from, to: pos, at: along, distance: round1(distance), design });
    }
  });
  return out;
}

export interface OpeningNeighbour {
  side: "left" | "right" | "up" | "down";
  item: TapeItem;
  /** Face to face, mm. */
  distance: number;
  /** Where the void's face and the column's face are (across or down the page), and where along them to draw. */
  from: number;
  to: number;
  at: number;
}

/** The nearest column, wall or lift core on each side of a void (side by side with it, or nearly), within 4 m. */
export function openingNeighbours(floor: Floor, el: OpeningEl, maxReach = 4000): OpeningNeighbour[] {
  const b = boxOf(floor, el, "actual");
  if (!b) return [];
  const best = new Map<OpeningNeighbour["side"], OpeningNeighbour>();
  for (const list of ["columns", "cores"] as const) {
    for (const t of floor[list] as TapeEl[]) {
      const ib = boxOf(floor, t, "actual");
      if (!ib) continue;
      // Side by side, or nearly (up to 1.5 m apart the other way): the distance is still worth showing.
      const overlapY = Math.min(b.y1, ib.y1) - Math.max(b.y0, ib.y0);
      const overlapX = Math.min(b.x1, ib.x1) - Math.max(b.x0, ib.x0);
      const NEAR = 1500;
      const consider = (side: OpeningNeighbour["side"], distance: number, from: number, to: number, at: number) => {
        if (distance < 0 || distance > maxReach) return;
        const cur = best.get(side);
        if (!cur || distance < cur.distance)
          best.set(side, { side, item: { list, el: t }, distance: round1(distance), from, to, at });
      };
      if (overlapY > -NEAR) {
        const at = overlapY > 0 ? (Math.max(b.y0, ib.y0) + Math.min(b.y1, ib.y1)) / 2 : (b.y0 + b.y1) / 2;
        if (ib.x1 <= b.x0 + 0.5) consider("left", b.x0 - ib.x1, b.x0, ib.x1, at);
        if (ib.x0 >= b.x1 - 0.5) consider("right", ib.x0 - b.x1, b.x1, ib.x0, at);
      }
      if (overlapX > -NEAR) {
        const at = overlapX > 0 ? (Math.max(b.x0, ib.x0) + Math.min(b.x1, ib.x1)) / 2 : (b.x0 + b.x1) / 2;
        if (ib.y1 <= b.y0 + 0.5) consider("up", b.y0 - ib.y1, b.y0, ib.y1, at);
        if (ib.y0 >= b.y1 - 0.5) consider("down", ib.y0 - b.y1, b.y1, ib.y0, at);
      }
    }
  }
  return (["left", "right", "up", "down"] as const)
    .map((sd) => best.get(sd))
    .filter((n): n is OpeningNeighbour => Boolean(n));
}

export function edgeDeviation(floor: Floor, edge: SlabEdge): number | null {
  if (edge.actual === null || edge.actual === undefined) return null;
  const a = edgePos(floor, edge, "actual");
  const d = edgePos(floor, edge, "design");
  return a === null || d === null ? null : round1(a - d);
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
