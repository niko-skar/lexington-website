import type { Axis, Floor } from "@/lib/asbuilt/types";

import { anchorPos, hangOnGrid, pointPos, refPos, wallLines, type P, type WallLine } from "./geometry";
import type { Anchor, PlanContent, PlanOpening, PlanPoint, PlanWall, SpaceLabel, WallKind } from "./types";

/**
 * Changes to a floor plan, as pure functions: each takes the plan and gives back a new one, so the
 * editor can undo them and show a change while a wall is still being dragged.
 */

const EPS = 0.5;
const r1 = (v: number) => Math.round(v * 10) / 10;

export function newKey(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export const EMPTY_PLAN: PlanContent = { name: "A", walls: [], openings: [], labels: [], targets: [] };

/** A point hung on the nearest grid lines. */
export function pointAt(floor: Floor, p: P): PlanPoint {
  return { x: hangOnGrid(floor, "x", p[0]), y: hangOnGrid(floor, "y", p[1]) };
}

/**
 * A new wall from a to b. It runs along the grid: across when it is wider than tall, else down, so
 * both ends share the anchor of the line they run on.
 */
export function makeWall(a: PlanPoint, b: PlanPoint, aPos: P, bPos: P, kind: WallKind, t: number): PlanWall {
  const across = Math.abs(bPos[0] - aPos[0]) >= Math.abs(bPos[1] - aPos[1]);
  return {
    _key: newKey("w"),
    a,
    b: across ? { x: b.x, y: { ...a.y } } : { x: { ...a.x }, y: b.y },
    kind,
    t,
  };
}

export function addWall(plan: PlanContent, wall: PlanWall): PlanContent {
  return { ...plan, walls: [...plan.walls, wall] };
}

/** Removes a wall with its doors and windows. */
export function removeWall(plan: PlanContent, key: string): PlanContent {
  return { ...plan, walls: plan.walls.filter((w) => w._key !== key), openings: plan.openings.filter((o) => o.wall !== key) };
}

export function updateWall(plan: PlanContent, key: string, change: Partial<PlanWall>): PlanContent {
  return { ...plan, walls: plan.walls.map((w) => (w._key === key ? { ...w, ...change } : w)) };
}

/** The ends of other walls that sit on a wall's centre line (a corner or a T onto it). */
export function attachedEnds(floor: Floor, plan: PlanContent, key: string): { wall: string; end: "a" | "b" }[] {
  const lines = wallLines(floor, plan);
  const w = lines.find((l) => l.key === key);
  if (!w) return [];
  const out: { wall: string; end: "a" | "b" }[] = [];
  for (const o of plan.walls) {
    if (o._key === key) continue;
    for (const end of ["a", "b"] as const) {
      const p = pointPos(floor, o[end]);
      if (!p) continue;
      const [along, across] = w.dir === "h" ? [p[0], p[1]] : [p[1], p[0]];
      if (Math.abs(across - w.c) < EPS && along >= w.s0 - EPS && along <= w.s1 + EPS) out.push({ wall: o._key, end });
    }
  }
  return out;
}

/**
 * Moves a wall square to itself (its centre line to `anchor`), carrying with it the ends of the
 * walls that meet it, so a room stays closed: drag one wall and the rooms either side change size.
 */
export function moveWall(plan: PlanContent, floor: Floor, key: string, anchor: Anchor, attached: { wall: string; end: "a" | "b" }[]): PlanContent {
  const w = plan.walls.find((x) => x._key === key);
  const line = w ? wallLines(floor, { walls: [w] })[0] : undefined;
  if (!w || !line) return plan;
  const axis: Axis = line.dir === "h" ? "y" : "x";
  const set = (p: PlanPoint): PlanPoint => ({ ...p, [axis]: { ...anchor } });
  const ends = new Map(attached.map((a) => [`${a.wall}:${a.end}`, true]));
  return {
    ...plan,
    walls: plan.walls.map((o) => {
      if (o._key === key) return { ...o, a: set(o.a), b: set(o.b) };
      const ma = ends.has(`${o._key}:a`);
      const mb = ends.has(`${o._key}:b`);
      return ma || mb ? { ...o, a: ma ? set(o.a) : o.a, b: mb ? set(o.b) : o.b } : o;
    }),
  };
}

/** Moves one end of a wall along it. */
export function moveEnd(plan: PlanContent, floor: Floor, key: string, end: "a" | "b", anchor: Anchor): PlanContent {
  const w = plan.walls.find((x) => x._key === key);
  const line = w ? wallLines(floor, { walls: [w] })[0] : undefined;
  if (!w || !line) return plan;
  const axis: Axis = line.dir === "h" ? "x" : "y";
  return updateWall(plan, key, { [end]: { ...w[end], [axis]: { ...anchor } } });
}

/** A wall's length, mm. */
export function wallLength(line: WallLine): number {
  return r1(line.s1 - line.s0);
}

/** Sets a wall's length, keeping its first end (a) where it is. */
export function setLength(plan: PlanContent, floor: Floor, key: string, length: number): PlanContent {
  const w = plan.walls.find((x) => x._key === key);
  const line = w ? wallLines(floor, { walls: [w] })[0] : undefined;
  if (!w || !line || length < 10) return plan;
  const axis: Axis = line.dir === "h" ? "x" : "y";
  const a = anchorPos(floor, axis, w.a[axis]);
  const b = anchorPos(floor, axis, w.b[axis]);
  if (a === null || b === null) return plan;
  const sign = b >= a ? 1 : -1;
  const target = a + sign * length;
  const ref = w.b[axis].ref;
  const at = refPos(floor, axis, ref);
  const anchor: Anchor = at === null ? hangOnGrid(floor, axis, target) : { ref, d: r1(target - at) };
  return updateWall(plan, key, { b: { ...w.b, [axis]: anchor } });
}

// ---- doors, windows, room names ---------------------------------------------------------------------

export function addOpening(plan: PlanContent, opening: PlanOpening): PlanContent {
  return { ...plan, openings: [...plan.openings, opening] };
}

export function updateOpening(plan: PlanContent, key: string, change: Partial<PlanOpening>): PlanContent {
  return { ...plan, openings: plan.openings.map((o) => (o._key === key ? { ...o, ...change } : o)) };
}

export function removeOpening(plan: PlanContent, key: string): PlanContent {
  return { ...plan, openings: plan.openings.filter((o) => o._key !== key) };
}

export function addLabel(plan: PlanContent, label: SpaceLabel): PlanContent {
  return { ...plan, labels: [...plan.labels, label] };
}

export function updateLabel(plan: PlanContent, key: string, change: Partial<SpaceLabel>): PlanContent {
  return { ...plan, labels: plan.labels.map((l) => (l._key === key ? { ...l, ...change } : l)) };
}

export function removeLabel(plan: PlanContent, key: string): PlanContent {
  return { ...plan, labels: plan.labels.filter((l) => l._key !== key) };
}

/** The stated area a home is checked against (its contract), or null to use the website's. */
export function setTarget(plan: PlanContent, unit: string, stated: number | null): PlanContent {
  const rest = plan.targets.filter((t) => t.unit !== unit);
  return { ...plan, targets: stated && stated > 0 ? [...rest, { _key: newKey("t"), unit, stated }] : rest };
}

// ---- copying a layout to another floor ----------------------------------------------------------------

/**
 * The same layout on another floor. Anchors on grid lines and slab edges carry over as they are; an
 * anchor on a column that the other floor doesn't have is hung on the nearest grid line at the same
 * place, so nothing is lost.
 */
export function portPlan(plan: PlanContent, from: Floor, to: Floor): PlanContent {
  const port = (axis: Axis, a: Anchor): Anchor => {
    if (refPos(to, axis, a.ref) !== null) return { ...a };
    const v = anchorPos(from, axis, a);
    return v === null ? { ...a } : hangOnGrid(to, axis, v);
  };
  const pt = (p: PlanPoint): PlanPoint => ({ x: port("x", p.x), y: port("y", p.y) });
  return {
    ...plan,
    walls: plan.walls.map((w) => ({ ...w, a: pt(w.a), b: pt(w.b) })),
    openings: plan.openings.map((o) => ({ ...o })),
    labels: plan.labels.map((l) => ({ ...l, at: pt(l.at) })),
    targets: plan.targets.map((t) => ({ ...t })),
  };
}

/** The same plan with new keys (a copy that is its own option). */
export function cloneWithNewKeys(plan: PlanContent): PlanContent {
  const wallKey = new Map(plan.walls.map((w) => [w._key, newKey("w")]));
  return {
    ...plan,
    walls: plan.walls.map((w) => ({ ...w, _key: wallKey.get(w._key)! })),
    openings: plan.openings.map((o) => ({ ...o, _key: newKey("o"), wall: wallKey.get(o.wall) ?? o.wall })),
    labels: plan.labels.map((l) => ({ ...l, _key: newKey("l") })),
    targets: plan.targets.map((t) => ({ ...t, _key: newKey("t") })),
  };
}
