import { boxOf, centreOf, findBox, isMeasured, linePos, round1, type Box } from "./geometry";
import type { BoxEl, BoxList, Faces, Floor, Tolerance } from "./types";

/**
 * Setting out a floor's columns so they sit on the ones below (Niko, 15 Oct
 * 2026). For each column on this floor, find the one in the same place on the
 * floor below. If that one has been measured, carry its offset from the
 * drawing up (so the new column sits on it); otherwise use the drawing. Sizes
 * always come from this floor's drawing, so a column that gets smaller going up
 * keeps the same face flush that the engineer drew.
 *
 * `pullBack` optionally takes back up to that many mm per floor towards the
 * drawing, so an error below is not carried all the way up.
 */

export type SetOutBasis = "measured" | "drawing" | "nothing-below";

export interface SetOutRow {
  list: BoxList;
  key: string;
  el: BoxEl;
  /** Faces to mark, from this floor's own grid lines (l/r from line x, t/b from line y). */
  target: Faces;
  box: Box;
  basis: SetOutBasis;
  /** How far the column below is from its drawing position (centre), when measured. */
  below: { dx: number; dy: number } | null;
  /** How far the target is from this floor's drawing position (centre). */
  shift: { dx: number; dy: number };
  /** Where the drawings themselves put this column off the one below (centre), if they do. */
  drawnStep: { dx: number; dy: number } | null;
  flag: "none" | "warn" | "off";
}

function pull(v: number, by: number): number {
  if (by <= 0) return v;
  const left = Math.max(0, Math.abs(v) - by);
  return Math.sign(v) * left;
}

export function setOutRows(floor: Floor, below: Floor | null, tol: Tolerance, pullBack = 0): SetOutRow[] {
  const rows: SetOutRow[] = [];
  const lists: BoxList[] = ["columns", "cores"];
  for (const list of lists) {
    for (const el of floor[list] as BoxEl[]) {
      const design = boxOf(floor, el, "design");
      const lx = linePos(floor, "x", el.x, "actual");
      const ly = linePos(floor, "y", el.y, "actual");
      if (!design || lx === null || ly === null) continue;
      const [cx, cy] = centreOf(design);
      const w = design.x1 - design.x0;
      const h = design.y1 - design.y0;

      const under = below ? findBox(below, list, el._key) : undefined;
      let basis: SetOutBasis = "nothing-below";
      let belowDev: { dx: number; dy: number } | null = null;
      let drawnStep: { dx: number; dy: number } | null = null;
      let dx = 0;
      let dy = 0;
      if (below && under) {
        const ud = boxOf(below, under, "design");
        const ua = boxOf(below, under, "actual");
        if (ud && ua) {
          const [udx, udy] = centreOf(ud);
          const [uax, uay] = centreOf(ua);
          belowDev = { dx: round1(uax - udx), dy: round1(uay - udy) };
          // A column that gets smaller going up keeps one face flush: that's drawn on purpose.
          // Only flag it when no face (and not the centre) lines up with the one below.
          const lines = (a0: number, a1: number, b0: number, b1: number) =>
            Math.abs(a0 - b0) < 5 || Math.abs(a1 - b1) < 5 || Math.abs((a0 + a1) / 2 - (b0 + b1) / 2) < 5;
          const stepX = lines(design.x0, design.x1, ud.x0, ud.x1) ? 0 : round1(cx - udx);
          const stepY = lines(design.y0, design.y1, ud.y0, ud.y1) ? 0 : round1(cy - udy);
          if (stepX || stepY) drawnStep = { dx: stepX, dy: stepY };
          basis = isMeasured(under) ? "measured" : "drawing";
          dx = pull(belowDev.dx, pullBack);
          dy = pull(belowDev.dy, pullBack);
        }
      }

      const box: Box = { x0: cx + dx - w / 2, x1: cx + dx + w / 2, y0: cy + dy - h / 2, y1: cy + dy + h / 2 };
      const worst = Math.max(Math.abs(dx), Math.abs(dy));
      rows.push({
        list,
        key: el._key,
        el,
        target: {
          l: round1(box.x0 - lx),
          r: round1(box.x1 - lx),
          t: round1(box.y0 - ly),
          b: round1(box.y1 - ly),
        },
        box,
        basis,
        below: basis === "measured" ? belowDev : null,
        shift: { dx: round1(dx), dy: round1(dy) },
        drawnStep,
        flag: worst > tol.warn ? "off" : worst > tol.ok ? "warn" : "none",
      });
    }
  }
  return rows;
}

/** The floor directly below, by order. */
export function floorBelow(floors: Floor[], floor: Floor): Floor | null {
  const lower = floors.filter((f) => f.order < floor.order).sort((a, b) => b.order - a.order);
  return lower[0] ?? null;
}
