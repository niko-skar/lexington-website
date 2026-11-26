import { mm } from "./format";
import { boxOf, edgeSegment, gridLines, linePos, slabCorners, type Point } from "./geometry";
import { EDGES_PATH, pathOf, sameValue } from "./paths";
import type { Axis, Change, ColumnEl, CoreEl, EdgeFigure, Floor, SlabEdge } from "./types";

/**
 * Splitting a slab edge where its length changes (Niko, 26 Nov 2026, on the 2nd floor's edge from D to G below
 * grid 7: "i need to be able to change each cantilever length, here on the 2nd floor i cant these two cantilevers
 * are joined"). The drawings sometimes run one edge past several columns; on site each bay can come out its own
 * length. A split cuts the edge at a grid line: the edge keeps the piece before the line (going round the
 * outline), a new piece ("part") carries on after it, and a "step" on the grid line joins them. The edge keeps its
 * own measurement; the new piece has none of its own, so it stays in line with the edge (geometry.ts resolveFloor)
 * until it is measured, or a column's figure in front of it goes with it. Joining takes the two back into one.
 * Neither ever changes the drawing's outline.
 */

/** A split never leaves a piece shorter than this, mm. */
export const MIN_PIECE = 200;

type TapeList = "columns" | "cores";
type TapeEl = ColumnEl | CoreEl;

/** A figure taped from a column's face to the edge being split or joined. */
export interface FigureOnEdge {
  list: TapeList;
  key: string;
  /** "C1b F/7", or a lift core's name. */
  name: string;
  d: number;
}

export interface SplitPlan {
  edges: SlabEdge[];
  edge: SlabEdge;
  part: SlabEdge;
  step: SlabEdge;
  /** What the edge runs between after the split, and the new piece: "G to F", "F to D". */
  first: string;
  second: string;
  /** Figures from columns standing in front of the new piece: they go with it. */
  moving: FigureOnEdge[];
  /** Figures from a column the grid line runs through: it faces both pieces, so they're asked about. */
  unsure: FigureOnEdge[];
}

export interface JoinPlan {
  edges: SlabEdge[];
  /** The edge the piece joins back onto, the step and the piece that go. */
  into: SlabEdge;
  step: SlabEdge;
  part: SlabEdge;
  /** What the joined edge runs between: "G to D". */
  span: string;
  changes: Change[];
  /** Figures that go with the piece: to the step, or a second one from a column that has one to the edge already. */
  dropped: FigureOnEdge[];
}

const along = (edge: SlabEdge): Axis => (edge.axis === "x" ? "y" : "x");
const coord = (p: Point, axis: Axis) => (axis === "x" ? p[0] : p[1]);

/** The grid line nearest a point along an edge. */
function nearestLine(floor: Floor, axis: Axis, v: number): string {
  let best = "";
  let bestD = Infinity;
  for (const g of gridLines(floor, axis)) {
    const at = linePos(floor, axis, g.id, "actual");
    if (at !== null && Math.abs(at - v) < bestD) {
      best = g.id;
      bestD = Math.abs(at - v);
    }
  }
  return best;
}

function segmentOf(floor: Floor, edgeKey: string, mode: "actual" | "design" = "actual"): { i: number; edge: SlabEdge; from: number; to: number } | null {
  const edges = floor.slab?.edges ?? [];
  const i = edges.findIndex((e) => e._key === edgeKey);
  const corners = slabCorners(floor, mode);
  if (i < 0 || !corners) return null;
  const [p, q] = edgeSegment(corners, i);
  const ax = along(edges[i]);
  return { i, edge: edges[i], from: coord(p, ax), to: coord(q, ax) };
}

/** "G to F": the grid lines nearest two points along an edge, in the order the outline runs. */
function spanWords(floor: Floor, edge: SlabEdge, from: number, to: number): string {
  const ax = along(edge);
  return `${nearestLine(floor, ax, from)} to ${nearestLine(floor, ax, to)}`;
}

/**
 * The grid lines a slab edge can be split at: across it, at least MIN_PIECE in from both ends, as built and on the
 * drawing (a split never changes the drawing's outline, so the line must cross the drawn edge too).
 */
export function splitLines(floor: Floor, edgeKey: string): string[] {
  const built = segmentOf(floor, edgeKey, "actual");
  const drawn = segmentOf(floor, edgeKey, "design");
  if (!built || !drawn || built.edge.split === "step") return [];
  const ax = along(built.edge);
  const inside = (seg: { from: number; to: number }, at: number | null) =>
    at !== null && at > Math.min(seg.from, seg.to) + MIN_PIECE && at < Math.max(seg.from, seg.to) - MIN_PIECE;
  return gridLines(floor, ax)
    .filter((g) => inside(built, linePos(floor, ax, g.id, "actual")) && inside(drawn, linePos(floor, ax, g.id, "design")))
    .map((g) => g.id);
}

function freeKey(used: Set<string>, base: string): string {
  const clean = base.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 34);
  let key = clean;
  for (let n = 2; used.has(key); n += 1) key = `${clean}${n}`;
  used.add(key);
  return key;
}

function tapeEls(floor: Floor): { list: TapeList; el: TapeEl }[] {
  return [
    ...floor.columns.map((el) => ({ list: "columns" as const, el: el as TapeEl })),
    ...floor.cores.map((el) => ({ list: "cores" as const, el: el as TapeEl })),
  ];
}

const nameOf = (list: TapeList, el: TapeEl) => (list === "columns" ? `${el.name} ${el.x}/${el.y}` : el.name);

/** How splitting this edge at a grid line would go (null when it can't be split there). */
export function splitPlan(floor: Floor, edgeKey: string, lineId: string): SplitPlan | null {
  const seg = segmentOf(floor, edgeKey);
  if (!seg || !splitLines(floor, edgeKey).includes(lineId)) return null;
  const { i, edge, from, to } = seg;
  const ax = along(edge);
  const at = linePos(floor, ax, lineId, "actual")!;
  const edges = floor.slab!.edges;
  const used = new Set(edges.map((e) => e._key));
  const step: SlabEdge = { _key: freeKey(used, `${edge._key}${lineId}s`), axis: ax, ref: lineId, design: 0, split: "step" };
  const part: SlabEdge = {
    _key: freeKey(used, `${edge._key}${lineId}`),
    axis: edge.axis,
    ref: edge.ref,
    design: edge.design,
    ...(edge.note ? { note: edge.note } : {}),
    split: "part",
  };

  // Which piece each column's figure to this edge belongs to: the one its column stands in front of.
  const onward = Math.sign(to - at);
  const moving: FigureOnEdge[] = [];
  const unsure: FigureOnEdge[] = [];
  for (const { list, el } of tapeEls(floor)) {
    const figure = el.edges?.find((f) => f.edge === edgeKey);
    if (!figure) continue;
    const b = boxOf(floor, el, "actual");
    if (!b) continue;
    const lo = ax === "x" ? b.x0 : b.y0;
    const hi = ax === "x" ? b.x1 : b.y1;
    const it = { list, key: el._key, name: nameOf(list, el), d: figure.d };
    if (at > lo + 1 && at < hi - 1) unsure.push(it);
    else if (Math.sign((lo + hi) / 2 - at) === onward) moving.push(it);
  }

  return {
    edges: [...edges.slice(0, i + 1), step, part, ...edges.slice(i + 1)],
    edge,
    part,
    step,
    first: spanWords(floor, edge, from, at),
    second: spanWords(floor, edge, at, to),
    moving,
    unsure,
  };
}

/** The changes that split the edge; figures the grid line runs through go to `unsureTo` ("first" = stay). */
export function splitChanges(floor: Floor, plan: SplitPlan, unsureTo: "first" | "second" = "first"): Change[] {
  const changes: Change[] = [{ path: EDGES_PATH, value: plan.edges }];
  const goes = [...plan.moving, ...(unsureTo === "second" ? plan.unsure : [])];
  for (const it of goes) {
    const el = tapeEls(floor).find((t) => t.list === it.list && t.el._key === it.key)?.el;
    if (!el?.edges) continue;
    changes.push({
      path: pathOf(it.list, it.key, "edges"),
      value: el.edges.map((f) => (f.edge === plan.edge._key ? { ...f, edge: plan.part._key } : f)),
    });
  }
  return changes;
}

/** How joining a split-off piece back onto the edge before it would go (null when it isn't one). */
export function joinPlan(floor: Floor, partKey: string): JoinPlan | null {
  const edges = floor.slab?.edges ?? [];
  const n = edges.length;
  const i = edges.findIndex((e) => e._key === partKey);
  if (i < 0 || n < 6) return null;
  const part = edges[i];
  const step = edges[(i - 1 + n) % n];
  const into = edges[(i - 2 + n) % n];
  if (part.split !== "part" || step.split !== "step" || into.axis !== part.axis || into.ref !== part.ref) return null;
  const next = edges.filter((e) => e._key !== part._key && e._key !== step._key);

  const changes: Change[] = [{ path: EDGES_PATH, value: next }];
  const dropped: FigureOnEdge[] = [];
  for (const { list, el } of tapeEls(floor)) {
    const figures = el.edges ?? [];
    const onPart = figures.find((f) => f.edge === part._key);
    const onStep = figures.find((f) => f.edge === step._key);
    if (!onPart && !onStep) continue;
    const hasInto = figures.some((f) => f.edge === into._key);
    const kept: EdgeFigure[] = [];
    for (const f of figures) {
      if (f.edge === step._key || (f.edge === part._key && hasInto)) {
        dropped.push({ list, key: el._key, name: nameOf(list, el), d: f.d });
        continue;
      }
      kept.push(f.edge === part._key ? { ...f, edge: into._key } : f);
    }
    changes.push({ path: pathOf(list, el._key, "edges"), value: kept.length ? kept : null });
  }

  const intoSeg = segmentOf(floor, into._key);
  const partSeg = segmentOf(floor, part._key);
  const span = intoSeg && partSeg ? spanWords(floor, into, intoSeg.from, partSeg.to) : "";
  return { edges: next, into, step, part, span, changes, dropped };
}

/** "G to F and F to D": the words for the history when an edge is split. */
export function splitText(plan: SplitPlan, unsureTo: "first" | "second" = "first"): string {
  const unsure = plan.unsure.length
    ? ` (${plan.unsure.map((u) => `${u.name}'s ${mm(u.d)}`).join(", ")} kept on ${unsureTo === "first" ? plan.first : plan.second})`
    : "";
  return `Slab edge ${plan.first.split(" to ")[0]} to ${plan.second.split(" to ")[1]} split at grid ${plan.step.ref}: ${plan.first} and ${plan.second} each have their own length now${unsure}`;
}

// ---- the server's check -------------------------------------------------------------------------------------

const same = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;

/** The outline without repeated corners or corners an edge runs straight through. */
function plainOutline(points: Point[]): Point[] {
  let out = points.filter((p, k) => !same(p, points[(k + 1) % points.length]));
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let k = 0; k < out.length; k += 1) {
      const a = out[(k - 1 + out.length) % out.length];
      const b = out[k];
      const c = out[(k + 1) % out.length];
      const straightX = Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5 && (b[1] - a[1]) * (c[1] - b[1]) > 0;
      const straightY = Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5 && (b[0] - a[0]) * (c[0] - b[0]) > 0;
      if (straightX || straightY) {
        out = [...out.slice(0, k), ...out.slice(k + 1)];
        changed = true;
        break;
      }
    }
  }
  return out;
}

function sameOutline(a: Point[], b: Point[]): boolean {
  const pa = plainOutline(a);
  const pb = plainOutline(b);
  if (pa.length !== pb.length || !pa.length) return false;
  const start = pb.findIndex((p) => same(p, pa[0]));
  return start >= 0 && pa.every((p, k) => same(p, pb[(start + k) % pb.length]));
}

/**
 * Why a new list of slab edges can't take the place of the floor's own, or null when it can: only pieces split off
 * in the app come or go, every other edge stays exactly as stored and in its order, the edges still go round
 * across and down in turn, and the drawing's outline is the same as before.
 */
export function edgesProblem(floor: Floor, next: SlabEdge[]): string | null {
  const cur = floor.slab?.edges ?? [];
  if (!cur.length) return "This floor has no slab edges.";
  if (next.length < 4 || next.length > 160) return "Those slab edges don't look right.";
  const keys = new Set(next.map((e) => e._key));
  if (keys.size !== next.length) return "Those slab edges don't look right.";
  for (let k = 0; k < next.length; k += 1)
    if (next[k].axis === next[(k + 1) % next.length].axis) return "The slab edges must go round across and down in turn.";
  for (const e of next) {
    const old = cur.find((c) => c._key === e._key);
    if (old && !sameValue(old, e)) return "The slab edges have changed since. Reload the page, or undo the newer changes first.";
    if (!old && e.split !== "part" && e.split !== "step") return "Only a split can add a piece of slab edge.";
    if (!floor.grid.some((g) => g.axis === e.axis && g.id === e.ref)) return "That grid line isn't on this floor.";
  }
  for (const c of cur) if (!keys.has(c._key) && c.split !== "part" && c.split !== "step") return "Slab edges from the drawings can't be taken away.";
  const order = (list: SlabEdge[], from: SlabEdge[]) => list.filter((e) => from.some((f) => f._key === e._key)).map((e) => e._key).join(",");
  if (order(next, cur) !== order(cur, next)) return "The slab edges can't change their order.";
  const before = slabCorners(floor, "design");
  const after = slabCorners({ ...floor, slab: { edges: next } }, "design");
  if (!before || !after || !sameOutline(before, after)) return "A split can't change the drawing's outline.";
  return null;
}
