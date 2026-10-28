import type {
  Axis,
  BoxEl,
  BoxList,
  ColumnEl,
  CoreEl,
  CoreFaces,
  EdgeFigure,
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

/** A grid line's stored position: the drawing plus any spacing taped between grid lines (see shiftsForGap). */
const storedPos = (line: GridLine) => line.design + (line.shift ?? 0);

/**
 * Where a grid line is. "actual": where all the figures taped on the floor put it, measured from
 * the fixed column (see resolveFloor), so every line is one straight line.
 */
export function linePos(floor: Floor, axis: Axis, id: string, mode: Mode): number | null {
  const line = lineOf(floor, axis, id);
  if (!line) return null;
  if (mode === "design") return line.design;
  return resolveFloor(floor).lines.get(`${axis}:${id}`) ?? storedPos(line);
}

export interface Gap {
  from: GridLine;
  to: GridLine;
  design: number;
  /** As stored: the drawing, or the spacing taped between the two lines. */
  typed: number;
  /** On the plan: where all the figures put the two lines. */
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
      typed: round1(storedPos(to) - storedPos(from)),
      actual: round1((linePos(floor, axis, to.id, "actual") ?? 0) - (linePos(floor, axis, from.id, "actual") ?? 0)),
      measured: to.measured === true,
    });
  }
  return out;
}

/**
 * The stored spacings after one is typed: that line and every line after it shift by the same
 * amount, so every other stored spacing stays as it was. Returns the new shift of each moved line.
 */
export function shiftsForGap(
  floor: Floor,
  axis: Axis,
  toId: string,
  newGap: number,
): { id: string; key: string; shift: number }[] {
  const gap = gapsOf(floor, axis).find((g) => g.to.id === toId);
  if (!gap) return [];
  const delta = newGap - gap.typed;
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

// ---- where everything is: one fixed column, straight grid lines, every figure together ----------

export type Face = "l" | "r" | "t" | "b";

/**
 * The column everything on a floor is measured from (Niko, 28 Oct 2026: "fixing one point on the
 * furthermost bottom right hand column so all the measurements start from there and fan out"):
 * the right-most column on the lowest row. N/7 on the ground to 6th floors, M/7 on the 7th.
 * It stays exactly where the drawing has it.
 */
export function fixedColumnOf(floor: Floor): ColumnEl | null {
  let best: ColumnEl | null = null;
  let bestX = -Infinity;
  let bestY = -Infinity;
  for (const c of floor.columns) {
    if (c.kind !== "column") continue;
    const x = lineOf(floor, "x", c.x)?.design;
    const y = lineOf(floor, "y", c.y)?.design;
    if (x === undefined || y === undefined) continue;
    if (y > bestY || (y === bestY && x > bestX)) {
      best = c;
      bestX = x;
      bestY = y;
    }
  }
  return best;
}

export type FitKind = "gap" | "edge" | "edgeGrid" | "grid";

/**
 * One figure taped on site, exactly as typed, and how well it fits all the others: the same
 * distance on the plan, with every grid line straight and the fixed column where the drawing has it.
 */
export interface FigureFit {
  kind: FitKind;
  /** Across the page (x) or down it (y). */
  axis: Axis;
  /** As typed, mm: face to face (gap), face to edge, edge from its grid line, or grid spacing. */
  typed: number;
  /** The same distance on the plan, mm. */
  fitted: number;
  /** The plan less the figure, mm: how far this figure is from fitting the others. */
  off: number;
  /** A gap: the two items, and the row or line it was taped along. */
  prev?: TapeItem;
  next?: TapeItem;
  lineId?: string;
  /** A figure to a slab edge: the column it was taped from, and its face. */
  item?: TapeItem;
  face?: Face;
  edge?: SlabEdge;
  figure?: EdgeFigure;
  /** A grid spacing. */
  from?: GridLine;
  to?: GridLine;
}

/** One figure taped from a column's face to a slab edge (a FigureFit of kind "edge"). */
export interface FigureCheck {
  item: TapeItem;
  edge: SlabEdge;
  figure: EdgeFigure;
  /** The face that looks at the edge (from the drawing). */
  face: Face;
  /** Face to edge as the plan has it, mm. */
  now: number;
  /** The plan less the figure, mm. */
  off: number;
}

export interface Resolved {
  boxes: Map<string, Box>;
  /** Each slab edge's position as built: x for an up-and-down edge, y for an across one. */
  edges: Map<string, number>;
  /** Each grid line's position as built, keyed "x:N", "y:7". */
  lines: Map<string, number>;
  /** The column everything is measured from (null on a floor without columns). */
  fixed: TapeItem | null;
  /** Every figure taped on the floor and how well it fits. */
  fits: FigureFit[];
  /** The figures to the slab edges (the same as fits of kind "edge"). */
  figures: FigureCheck[];
}

const resolvedCache = new WeakMap<Floor, Resolved>();

function edgeFrom(floor: Floor, edge: SlabEdge, mode: Mode): number | null {
  const line = linePos(floor, edge.axis, edge.ref, mode);
  if (line === null) return null;
  return line + (mode === "actual" ? (edge.actual ?? edge.design) : edge.design);
}

/** Which face of a column looks at a slab edge, from the drawing: the edge lies past it on that side. */
export function faceToward(floor: Floor, el: TapeEl, edge: SlabEdge): Face | null {
  const d = boxFromFaces(floor, el, el.design, "design");
  const pos = edgeFrom(floor, edge, "design");
  if (!d || pos === null) return null;
  if (edge.axis === "y") return pos >= d.y1 ? "b" : pos <= d.y0 ? "t" : null;
  return pos >= d.x1 ? "r" : pos <= d.x0 ? "l" : null;
}

/** A taped figure counts as about 5 mm sure; the drawing's spacings only fill in where nothing was taped. */
const FIGURE_WEIGHT = 1 / 5 ** 2;
const DRAWING_WEIGHT = 1 / 300 ** 2;
/** Beyond this many mm out, a figure is trusted less, so one wrong figure shows up on its own. */
const ROBUST_MM = 15;

/** An item's centre from its own grid lines and its size: taped where taped, the drawing elsewhere. */
function itemGeometry(el: TapeEl): { ox: number; oy: number; w: number; h: number } {
  const f = el.actual ?? el.design;
  return {
    ox: (f.l + f.r) / 2,
    oy: (f.t + f.b) / 2,
    w: has(el.w) ? el.w : f.r - f.l,
    h: has(el.h) ? el.h : f.b - f.t,
  };
}

/** One equation: sum of coef × position = rhs. A taped figure carries its fit. */
interface Equation {
  coef: [string, number][];
  rhs: number;
  weight: number;
  fit?: Omit<FigureFit, "fitted" | "off">;
}

const lineVar = (axis: Axis, id: string) => `${axis}:${id}`;
const edgeVar = (key: string) => `e:${key}`;

/** Least squares over the unknown positions, with the fixed ones known. Returns every position. */
function solveLeastSquares(eqs: Equation[], weights: number[], known: Map<string, number>): Map<string, number> {
  const vars = [...new Set(eqs.flatMap((e) => e.coef.map(([v]) => v)))].filter((v) => !known.has(v)).sort();
  const idx = new Map(vars.map((v, i) => [v, i] as const));
  const n = vars.length;
  const m = Array.from({ length: n }, () => new Float64Array(n + 1));
  eqs.forEach((eq, k) => {
    const w = eq.weight * weights[k];
    let rhs = eq.rhs;
    const free: [number, number][] = [];
    for (const [v, a] of eq.coef) {
      const fixed = known.get(v);
      if (fixed !== undefined) rhs -= a * fixed;
      else free.push([idx.get(v)!, a]);
    }
    for (const [i, ai] of free) {
      m[i][n] += w * ai * rhs;
      for (const [j, aj] of free) m[i][j] += w * ai * aj;
    }
  });
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    const p = m[col][col];
    if (Math.abs(p) < 1e-12) continue;
    for (let r = 0; r < n; r += 1) {
      if (r === col || m[r][col] === 0) continue;
      const f = m[r][col] / p;
      for (let c = col; c <= n; c += 1) m[r][c] -= f * m[col][c];
    }
  }
  const out = new Map(known);
  vars.forEach((v, i) => out.set(v, Math.abs(m[i][i]) < 1e-12 ? 0 : m[i][n] / m[i][i]));
  return out;
}

const residualOf = (eq: Equation, sol: Map<string, number>) =>
  eq.rhs - eq.coef.reduce((sum, [v, a]) => sum + a * (sol.get(v) ?? 0), 0);

/**
 * Where every grid line, column, wall, lift core and slab edge really is (Niko, 28 Oct 2026: "fix
 * one point on the furthermost bottom right hand column so all the measurements start from there
 * and fan out, so everything has to be in relation to that one column"):
 * 1. The fixed column (fixedColumnOf) stays where the drawing has it.
 * 2. Every grid line is ONE straight line. Each column, wall and lift core stands on its two lines,
 *    as on the drawing, or as taped from the string lines (its faces from the grid lines).
 * 3. Where each line is comes from every figure taped on the floor together, measured out from the
 *    fixed column: gaps between columns, sizes, figures to slab edges, edges from their grid lines,
 *    spacings between grid lines. Where nothing was taped, the drawing's spacing fills in.
 * 4. Figures that don't agree are not smoothed into the columns: each figure is kept exactly as
 *    typed and shows how far it is from fitting the others (a figure well out is trusted less, so a
 *    single wrong figure stands out on its own). A figure never moves a run of columns.
 */
export function resolveFloor(floor: Floor): Resolved {
  const cached = resolvedCache.get(floor);
  if (cached) return cached;
  const lists: TapeList[] = ["columns", "cores"];
  const items: TapeItem[] = lists.flatMap((list) => (floor[list] as TapeEl[]).map((el) => ({ list, el })));
  const eqs: Equation[] = [];

  // Gaps taped between neighbours along each row (x) and down each line (y).
  for (const axis of ["x", "y"] as const) {
    for (const lineId of chainLines(floor, axis)) {
      const chain = chainOf(floor, axis, lineId);
      for (let i = 1; i < chain.length; i += 1) {
        const prev = chain[i - 1];
        const next = chain[i];
        const typed = axis === "x" ? next.el.gx : next.el.gy;
        if (!has(typed)) continue;
        const a = itemGeometry(prev.el);
        const b = itemGeometry(next.el);
        const va = axis === "x" ? lineVar("x", prev.el.x) : lineVar("y", prev.el.y);
        const vb = axis === "x" ? lineVar("x", next.el.x) : lineVar("y", next.el.y);
        // (line b + offset b - half b) - (line a + offset a + half a) = the gap
        const rhs =
          axis === "x" ? typed - b.ox + b.w / 2 + a.ox + a.w / 2 : typed - b.oy + b.h / 2 + a.oy + a.h / 2;
        eqs.push({
          // Both on one line (nothing to place): the gap is only compared.
          coef: va === vb ? [] : [[vb, 1], [va, -1]],
          rhs,
          weight: FIGURE_WEIGHT,
          fit: { kind: "gap", axis, typed, prev, next, lineId },
        });
      }
    }
  }

  // Figures taped from a column face to a slab edge.
  const edgeList = floor.slab?.edges ?? [];
  for (const item of items) {
    for (const figure of item.el.edges ?? []) {
      const edge = edgeList.find((e) => e._key === figure.edge);
      const face = edge ? faceToward(floor, item.el, edge) : null;
      if (!edge || !face) continue;
      const g = itemGeometry(item.el);
      const v = edge.axis === "y" ? lineVar("y", item.el.y) : lineVar("x", item.el.x);
      const o = edge.axis === "y" ? g.oy : g.ox;
      const half = (edge.axis === "y" ? g.h : g.w) / 2;
      // Edge past the face: edge - (line + o + half) = d. Before it: (line + o - half) - edge = d.
      const past = face === "b" || face === "r";
      eqs.push({
        coef: past ? [[edgeVar(edge._key), 1], [v, -1]] : [[v, 1], [edgeVar(edge._key), -1]],
        rhs: past ? figure.d + o + half : figure.d - o + half,
        weight: FIGURE_WEIGHT,
        fit: { kind: "edge", axis: edge.axis, typed: figure.d, item, face, edge, figure },
      });
    }
  }

  // Slab edges from their grid lines: taped, or the drawing.
  for (const edge of edgeList) {
    if (!lineOf(floor, edge.axis, edge.ref)) continue;
    const coef: [string, number][] = [
      [edgeVar(edge._key), 1],
      [lineVar(edge.axis, edge.ref), -1],
    ];
    if (has(edge.actual))
      eqs.push({ coef, rhs: edge.actual, weight: FIGURE_WEIGHT, fit: { kind: "edgeGrid", axis: edge.axis, typed: edge.actual, edge } });
    else eqs.push({ coef, rhs: edge.design, weight: DRAWING_WEIGHT });
  }

  // Spacings between neighbouring grid lines: taped, or the drawing.
  for (const axis of ["x", "y"] as const) {
    const lines = gridLines(floor, axis);
    for (let i = 1; i < lines.length; i += 1) {
      const from = lines[i - 1];
      const to = lines[i];
      const spacing = storedPos(to) - storedPos(from);
      const coef: [string, number][] = [
        [lineVar(axis, to.id), 1],
        [lineVar(axis, from.id), -1],
      ];
      if (to.measured === true)
        eqs.push({ coef, rhs: spacing, weight: FIGURE_WEIGHT, fit: { kind: "grid", axis, typed: round1(spacing), from, to } });
      else eqs.push({ coef, rhs: spacing, weight: DRAWING_WEIGHT });
    }
  }

  // The fixed column's two lines, so that it stays where the drawing has it. A floor without
  // columns keeps its last line each way where it is stored.
  const known = new Map<string, number>();
  const fixedEl = fixedColumnOf(floor);
  const fixedBox = fixedEl ? boxFromFaces(floor, fixedEl, fixedEl.design, "design") : null;
  if (fixedEl && fixedBox) {
    const g = itemGeometry(fixedEl);
    const [cx, cy] = centreOf(fixedBox);
    known.set(lineVar("x", fixedEl.x), cx - g.ox);
    known.set(lineVar("y", fixedEl.y), cy - g.oy);
  } else {
    for (const axis of ["x", "y"] as const) {
      const last = gridLines(floor, axis).at(-1);
      if (last) known.set(lineVar(axis, last.id), storedPos(last));
    }
  }

  // Solve; then trust figures that are well out a little less, and solve again (robust least squares).
  const weights = eqs.map(() => 1);
  let sol = solveLeastSquares(eqs, weights, known);
  for (let round = 0; round < 25; round += 1) {
    eqs.forEach((eq, k) => {
      if (!eq.fit) return;
      const r = Math.abs(residualOf(eq, sol));
      weights[k] = r <= ROBUST_MM ? 1 : ROBUST_MM / r;
    });
    const next = solveLeastSquares(eqs, weights, known);
    let moved = 0;
    for (const [v, p] of next) moved = Math.max(moved, Math.abs(p - (sol.get(v) ?? 0)));
    sol = next;
    if (moved < 0.01) break;
  }

  // Every grid line (a line with nothing on it and no spacing stays where it is stored).
  const lines = new Map<string, number>();
  for (const g of floor.grid) lines.set(lineVar(g.axis, g.id), sol.get(lineVar(g.axis, g.id)) ?? storedPos(g));

  const boxes = new Map<string, Box>();
  for (const { list, el } of items) {
    const lx = lines.get(lineVar("x", el.x));
    const ly = lines.get(lineVar("y", el.y));
    if (lx === undefined || ly === undefined) continue;
    const g = itemGeometry(el);
    const cx = lx + g.ox;
    const cy = ly + g.oy;
    boxes.set(`${list}:${el._key}`, { x0: cx - g.w / 2, x1: cx + g.w / 2, y0: cy - g.h / 2, y1: cy + g.h / 2 });
  }

  const edges = new Map<string, number>();
  for (const edge of edgeList) {
    const p = sol.get(edgeVar(edge._key));
    if (p !== undefined) edges.set(edge._key, p);
  }

  const fits: FigureFit[] = [];
  eqs.forEach((eq) => {
    if (!eq.fit) return;
    const r = residualOf(eq, sol);
    fits.push({ ...eq.fit, fitted: round1(eq.fit.typed - r), off: round1(-r) || 0 });
  });
  const figures: FigureCheck[] = fits
    .filter((f) => f.kind === "edge")
    .map((f) => ({ item: f.item!, edge: f.edge!, figure: f.figure!, face: f.face!, now: f.fitted, off: f.off }));

  const resolved: Resolved = {
    boxes,
    edges,
    lines,
    fixed: fixedEl ? { list: "columns", el: fixedEl } : null,
    fits,
    figures,
  };
  resolvedCache.set(floor, resolved);
  return resolved;
}

/** Where every column, wall and lift core really is (see resolveFloor). */
export function resolvedBoxes(floor: Floor): Map<string, Box> {
  return resolveFloor(floor).boxes;
}

/** Is this the column the floor is measured from? */
export function isFixedColumn(floor: Floor, el: { _key: string }): boolean {
  return resolveFloor(floor).fixed?.el._key === el._key;
}

/** The figures taped to one slab edge, oldest first. */
export function edgeFigures(floor: Floor, edgeKey: string): FigureCheck[] {
  return resolveFloor(floor)
    .figures.filter((f) => f.edge._key === edgeKey)
    .sort((a, b) => (a.figure.at ?? "").localeCompare(b.figure.at ?? ""));
}

/** One column's figures to the slab edges. */
export function itemFigures(floor: Floor, el: TapeEl): FigureCheck[] {
  return resolveFloor(floor).figures.filter((f) => f.item.el._key === el._key);
}

/** The fit of the gap taped onto `next` along one axis (the later of the two holds it). */
export function gapFit(floor: Floor, axis: Axis, nextKey: string): FigureFit | undefined {
  return resolveFloor(floor).fits.find((f) => f.kind === "gap" && f.axis === axis && f.next?.el._key === nextKey);
}

/** The fit of a taped grid spacing (it is stored on the later line). */
export function gridFit(floor: Floor, axis: Axis, toId: string): FigureFit | undefined {
  return resolveFloor(floor).fits.find((f) => f.kind === "grid" && f.axis === axis && f.to?.id === toId);
}

/** Every figure that is out from the others by more than `allow` mm, worst first. */
export function clashesOf(floor: Floor, allow: number): FigureFit[] {
  return resolveFloor(floor)
    .fits.filter((f) => Math.abs(f.off) > allow)
    .sort((a, b) => Math.abs(b.off) - Math.abs(a.off));
}

export interface TapeGap {
  axis: Axis;
  prev: TapeItem;
  next: TapeItem;
  /** Clear gap, face to face, on the drawing. */
  design: number;
  /** Clear gap on the plan (from all the figures together). */
  actual: number;
  /** Centre to centre, on the plan and on the drawing. */
  cc: number;
  ccDesign: number;
  /** The gap itself was taped (it is stored on `next`). */
  measured: boolean;
  /** As taped, face to face, and the same centre to centre with the sizes as they stand. */
  typed: number | null;
  typedCc: number | null;
  /** The plan less the taped gap, mm. */
  off: number | null;
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
    const typed = axis === "x" ? next.el.gx : next.el.gy;
    const actual = round1(na[lo] - pa[hi]);
    const halves = (pa[hi] - pa[lo]) / 2 + (na[hi] - na[lo]) / 2;
    out.push({
      axis,
      prev,
      next,
      design: round1(nd[lo] - pd[hi]),
      actual,
      cc: round1(centreOf(na)[c] - centreOf(pa)[c]),
      ccDesign: round1(centreOf(nd)[c] - centreOf(pd)[c]),
      measured: has(typed),
      typed: has(typed) ? typed : null,
      typedCc: has(typed) ? round1(typed + halves) : null,
      off: has(typed) ? round1(actual - typed) : null,
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

/** Anything measured on this item: its faces from the grid, its size, the gap to it, or a figure to a slab edge. */
export function isMeasured(el: { actual?: unknown } & TapeMeasures): boolean {
  return (
    (el.actual !== null && el.actual !== undefined) ||
    has(el.w) ||
    has(el.h) ||
    has(el.gx) ||
    has(el.gy) ||
    (el.edges?.length ?? 0) > 0
  );
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

/** Where a slab edge is: on the drawing, or as built (from its grid measurement or the figures taped to it). */
export function edgePos(floor: Floor, edge: SlabEdge, mode: Mode): number | null {
  if (mode === "actual") {
    const p = resolveFloor(floor).edges.get(edge._key);
    if (p !== undefined) return p;
  }
  return edgeFrom(floor, edge, mode);
}

/** Measured from its grid line, or placed or checked by a figure taped from a column. */
export function edgeMeasured(floor: Floor, edge: SlabEdge): boolean {
  return has(edge.actual) || resolveFloor(floor).figures.some((f) => f.edge._key === edge._key);
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
  if (!edgeMeasured(floor, edge)) return null;
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
  for (const g of floor.grid) (g.axis === "x" ? xs : ys).push(linePos(floor, g.axis, g.id, "actual") ?? g.design);
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
