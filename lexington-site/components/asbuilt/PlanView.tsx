"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { mm } from "@/lib/asbuilt/format";
import { applyChanges, pathOf } from "@/lib/asbuilt/paths";
import {
  allBoxes,
  boxOf,
  boxStatus,
  chainLineOf,
  chainLines,
  chainOf,
  edgeDeviation,
  edgeReaches,
  openingNeighbours,
  edgeSegment,
  extentsOf,
  gapsOf,
  gridLines,
  linePos,
  slabCorners,
  statusFor,
  tapeGaps,
  type Box,
  type Point,
  type Status,
} from "@/lib/asbuilt/geometry";
import type {
  BoxEl,
  BoxList,
  ColumnEl,
  CoreEl,
  Faces,
  Floor,
  OpeningEl,
  Selection,
  Tolerance,
} from "@/lib/asbuilt/types";

import s from "./AsBuilt.module.css";

/** What is on screen: the drawing point (mm) at the top-left corner, and pixels per mm. */
interface View {
  x: number;
  y: number;
  k: number;
}

interface Props {
  floor: Floor;
  below: Floor | null;
  tol: Tolerance;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  placing: boolean;
  onPlace: (x: number, y: number) => void;
  onStartPlace: () => void;
  onCancelPlace: () => void;
  /** The plan fills the whole screen (phones). */
  full: boolean;
  onToggleFull: () => void;
  /** The floors above and below, for the switcher in full screen. */
  floorNav: { up: Floor | null; down: Floor | null; go: (key: string) => void };
  /** A selected void was dragged this far (mm, snapped) and let go. */
  onMoveOpening: (key: string, dx: number, dy: number) => void;
  /** A selected void was resized by a corner: its new faces. */
  onResizeOpening: (key: string, faces: Faces) => void;
}

type Corner = "tl" | "tr" | "bl" | "br";
interface Drag {
  key: string;
  dx: number;
  dy: number;
  /** Set when a corner is being dragged (resizing); otherwise the whole void moves. */
  corner?: Corner;
}

/** A void's faces after a move or a corner drag (never smaller than 50 mm). */
function draggedFaces(cur: Faces, d: Drag): Faces {
  if (!d.corner) return { l: cur.l + d.dx, r: cur.r + d.dx, t: cur.t + d.dy, b: cur.b + d.dy };
  const out = { ...cur };
  if (d.corner === "tl" || d.corner === "bl") out.l = Math.min(cur.l + d.dx, cur.r - 50);
  if (d.corner === "tr" || d.corner === "br") out.r = Math.max(cur.r + d.dx, cur.l + 50);
  if (d.corner === "tl" || d.corner === "tr") out.t = Math.min(cur.t + d.dy, cur.b - 50);
  if (d.corner === "bl" || d.corner === "br") out.b = Math.max(cur.b + d.dy, cur.t + 50);
  return out;
}

/** How finely a dragged void snaps (mm), by how far in the plan is zoomed. */
const dragSnap = (k: number) => (k >= 0.12 ? 5 : k >= 0.05 ? 10 : 25);

/** On screens narrower than this the panel is a sheet over the bottom of the screen. */
const SHEET_BELOW = 1000;
/** The share of the screen height the bottom sheet covers (see .panel in the CSS). */
const SHEET_SHARE = 0.58;

interface HitLabel {
  sel: Selection;
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_K = 0.002;
/** Pixels per mm from which the finer dimensions show: up and down gaps, column to slab edge, sizes. */
const ZOOM_DETAIL = 0.04;
const ZOOM_SIZES = 0.09;
const MAX_K = 2.5;
const TAP_MOVE_PX = 7;
const TAP_MS = 600;

const COL_CLASS: Record<Status, string> = {
  none: s.colNone,
  ok: s.colOk,
  warn: s.colWarn,
  off: s.colOff,
  new: s.colOk,
};
const CORE_CLASS: Record<Status, string> = {
  none: s.coreWall,
  ok: s.coreWallOk,
  warn: s.coreWallWarn,
  off: s.coreWallOff,
  new: s.coreWallOk,
};
const DIM_CLASS: Record<Status, string> = {
  none: s.dimText,
  ok: `${s.dimText} ${s.dimOk}`,
  warn: `${s.dimText} ${s.dimWarn}`,
  off: `${s.dimText} ${s.dimOff}`,
  new: s.dimText,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function sameSel(a: Selection | null, b: Selection): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "box" && b.kind === "box") return a.list === b.list && a.key === b.key;
  if (a.kind === "edge" && b.kind === "edge") return a.key === b.key && a.via?.key === b.via?.key;
  if (a.kind === "gap" && b.kind === "gap") return a.axis === b.axis && a.to === b.to;
  if (a.kind === "colgap" && b.kind === "colgap") return a.axis === b.axis && a.key === b.key;
  return false;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 ? clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2, 0, 1) : 0;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

export function PlanView({
  floor: baseFloor,
  below,
  tol,
  selection,
  onSelect,
  placing,
  onPlace,
  onStartPlace,
  onCancelPlace,
  full,
  onToggleFull,
  floorNav,
  onMoveOpening,
  onResizeOpening,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Null until the person moves the plan: until then it simply fits the floor.
  const [userView, setUserView] = useState<View | null>(null);
  const [showBelow, setShowBelow] = useState(false);
  // A void being dragged: shown moved while the finger is down, saved when it lifts.
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const floor = useMemo(() => {
    if (!drag) return baseFloor;
    const el = baseFloor.openings.find((o) => o._key === drag.key);
    const cur = el ? (el.actual ?? el.design) : null;
    if (!el || !cur) return baseFloor;
    const moved = draggedFaces(cur, drag);
    return applyChanges(baseFloor, [{ path: pathOf("openings", drag.key, "actual"), value: moved }]);
  }, [baseFloor, drag]);
  const viewRef = useRef<View | null>(null);
  const pendingView = useRef<View | null>(null);
  const frame = useRef(0);

  // Track the board's size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // From the saved floor, so dragging a void never shifts the whole view.
  const ext = useMemo(() => extentsOf(baseFloor), [baseFloor]);

  /**
   * "all" shows the whole floor. "height" fills the board top to bottom and starts at
   * the left end: on a phone the whole floor is too small to tap, so it opens like this
   * and you swipe along it.
   */
  const fitView = useCallback(
    (how: "all" | "height"): View | null => {
      if (!size.w || !size.h) return null;
      const padL = 96;
      const padT = 96;
      const padR = 24;
      const padB = 64;
      const kW = (size.w - padL - padR) / (ext.x1 - ext.x0 || 1);
      const kH = (size.h - padT - padB) / (ext.y1 - ext.y0 || 1);
      const k = clamp(how === "height" ? Math.max(kH, kW) : Math.min(kW, kH), MIN_K, MAX_K);
      // Centre the floor in the space left after the margins (or start at its left end).
      const spareX = Math.max(0, size.w - padL - padR - (ext.x1 - ext.x0) * k);
      const spareY = Math.max(0, size.h - padT - padB - (ext.y1 - ext.y0) * k);
      return { k, x: ext.x0 - (padL + spareX / 2) / k, y: ext.y0 - (padT + spareY / 2) / k };
    },
    [size.w, size.h, ext],
  );

  // Other floors keep the same view once it has been moved: the grid is shared.
  const fitted = useMemo(() => fitView(size.w < 640 ? "height" : "all"), [fitView, size.w]);
  const view = userView ?? fitted;

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const queueView = useCallback((next: View) => {
    pendingView.current = next;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pendingView.current) setUserView(pendingView.current);
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      const v = pendingView.current ?? viewRef.current;
      if (!v) return;
      const k = clamp(v.k * factor, MIN_K, MAX_K);
      const mx = v.x + sx / v.k;
      const my = v.y + sy / v.k;
      queueView({ k, x: mx - sx / k, y: my - sy / k });
    },
    [queueView],
  );

  // Mouse wheel / trackpad zoom (needs a non-passive listener to stop the page scrolling).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ---- layout of everything drawn in screen pixels (and what can be tapped) ----
  const drawing = useMemo(() => {
    if (!view || !size.w) return null;
    const { k } = view;
    const sx = (x: number) => (x - view.x) * k;
    const sy = (y: number) => (y - view.y) * k;
    const W = size.w;
    const H = size.h;
    const hits: HitLabel[] = [];
    const under: ReactNode[] = [];
    const over: ReactNode[] = [];

    const xLines = gridLines(floor, "x");
    const yLines = gridLines(floor, "y");
    // Room at the top for the full-screen floor switcher.
    const bubbleY = Math.max(sy(ext.y0) - 58, full ? 78 : 37);
    const chainY = bubbleY + 26;
    const bubbleX = Math.max(sx(ext.x0) - 58, 37);
    const chainX = bubbleX + 26;

    const hotLines = new Set<string>();
    if (selection?.kind === "gap") {
      const gap = gapsOf(floor, selection.axis).find((g) => g.to.id === selection.to);
      if (gap) {
        hotLines.add(`${selection.axis}:${gap.from.id}`);
        hotLines.add(`${selection.axis}:${gap.to.id}`);
      }
    } else if (selection?.kind === "edge") {
      const edge = floor.slab?.edges.find((e) => e._key === selection.key);
      if (edge) hotLines.add(`${edge.axis}:${edge.ref}`);
    } else if (selection?.kind === "box") {
      const el = (floor[selection.list] as BoxEl[]).find((e) => e._key === selection.key);
      if (el) {
        hotLines.add(`x:${el.x}`);
        hotLines.add(`y:${el.y}`);
      }
    } else if (selection?.kind === "colgap") {
      const el = (floor[selection.list] as BoxEl[]).find((e) => e._key === selection.key);
      if (el) hotLines.add(selection.axis === "x" ? `y:${el.y}` : `x:${el.x}`);
    }

    // Grid lines (under the drawing).
    for (const g of xLines) {
      const x = sx(g.design + (g.shift ?? 0));
      if (x < -20 || x > W + 20) continue;
      under.push(
        <line
          key={`gx${g.id}`}
          x1={x}
          x2={x}
          y1={bubbleY + 11}
          y2={H}
          className={hotLines.has(`x:${g.id}`) ? s.gridLineHot : s.gridLine}
        />,
      );
    }
    for (const g of yLines) {
      const y = sy(g.design + (g.shift ?? 0));
      if (y < -20 || y > H + 20) continue;
      under.push(
        <line
          key={`gy${g.id}`}
          y1={y}
          y2={y}
          x1={bubbleX + 11}
          x2={W}
          className={hotLines.has(`y:${g.id}`) ? s.gridLineHot : s.gridLine}
        />,
      );
    }

    // Bands behind the pinned bubbles and chains, so the plan can slide under them.
    if (bubbleY <= (full ? 78.5 : 37.5))
      over.push(<rect key="bandT" x={0} y={0} width={W} height={chainY + 12} className={s.band} />);
    if (bubbleX <= 37.5) over.push(<rect key="bandL" x={0} y={0} width={chainX + 12} height={H} className={s.band} />);

    const tick = (x: number, y: number, key: string) => (
      <line key={key} x1={x - 3.5} y1={y + 3.5} x2={x + 3.5} y2={y - 3.5} className={s.dimTick} />
    );

    // Grid chains: the spacing between neighbouring lines.
    for (const [axis, gaps] of [
      ["x", gapsOf(floor, "x")],
      ["y", gapsOf(floor, "y")],
    ] as const) {
      for (const gap of gaps) {
        const a = (axis === "x" ? sx : sy)(gap.from.design + (gap.from.shift ?? 0));
        const b = (axis === "x" ? sx : sy)(gap.to.design + (gap.to.shift ?? 0));
        const span = b - a;
        if (b < -10 || a > (axis === "x" ? W : H) + 10) continue;
        const sel: Selection = { kind: "gap", axis, to: gap.to.id };
        const hot = sameSel(selection, sel);
        const diff = Math.abs(gap.actual - gap.design);
        const cls = hot ? `${s.dimText} ${s.dimHot}` : gap.measured ? DIM_CLASS[statusFor(diff, tol)] : s.dimText;
        const label = mm(gap.actual);
        const key = `gap${axis}${gap.to.id}`;
        if (axis === "x") {
          over.push(
            <line key={`${key}l`} x1={a} x2={b} y1={chainY} y2={chainY} className={s.dimLine} />,
            tick(a, chainY, `${key}ta`),
            tick(b, chainY, `${key}tb`),
          );
          if (span >= label.length * 6.6 + 6)
            over.push(
              <text key={`${key}t`} x={(a + b) / 2} y={chainY - 8} className={cls}>
                {label}
              </text>,
            );
          hits.push({ sel, x: a, y: chainY - 18, w: Math.max(span, 14), h: 26 });
        } else {
          over.push(
            <line key={`${key}l`} y1={a} y2={b} x1={chainX} x2={chainX} className={s.dimLine} />,
            tick(chainX, a, `${key}ta`),
            tick(chainX, b, `${key}tb`),
          );
          if (span >= label.length * 6.6 + 6) {
            over.push(
              <text
                key={`${key}t`}
                x={chainX - 8}
                y={(a + b) / 2}
                transform={`rotate(-90 ${chainX - 8} ${(a + b) / 2})`}
                className={cls}
              >
                {label}
              </text>,
            );
          }
          hits.push({ sel, x: chainX - 18, y: a, w: 26, h: Math.max(span, 14) });
        }
      }
    }

    // Bubbles. Lines closer than a bubble apart (B, B1, B2; 7a, 7b) take turns stepping out a row.
    const bubble = (
      key: string,
      cx: number,
      cy: number,
      id: string,
      hot: boolean,
      lead?: { x1: number; y1: number },
    ) => (
      <g key={key}>
        {lead && <line x1={cx} y1={cy} x2={lead.x1} y2={lead.y1} className={s.dimLine} />}
        <circle cx={cx} cy={cy} r={10.5} className={hot ? `${s.bubble} ${s.bubbleHot}` : s.bubble} />
        <text x={cx} y={cy + 0.5} className={hot ? `${s.bubbleText} ${s.bubbleTextHot}` : s.bubbleText}>
          {id}
        </text>
      </g>
    );
    let prevX = -Infinity;
    let stepX = false;
    for (const g of xLines) {
      const x = sx(g.design + (g.shift ?? 0));
      stepX = x - prevX < 23 ? !stepX : false;
      prevX = x;
      if (x < -20 || x > W + 20) continue;
      const cy = stepX ? bubbleY - 23 : bubbleY;
      over.push(
        bubble(`bx${g.id}`, x, cy, g.id, hotLines.has(`x:${g.id}`), stepX ? { x1: x, y1: bubbleY + 10 } : undefined),
      );
    }
    let prevY = -Infinity;
    let stepY = false;
    for (const g of yLines) {
      const y = sy(g.design + (g.shift ?? 0));
      stepY = y - prevY < 23 ? !stepY : false;
      prevY = y;
      if (y < -20 || y > H + 20) continue;
      const cx = stepY ? bubbleX - 23 : bubbleX;
      over.push(
        bubble(`by${g.id}`, cx, y, g.id, hotLines.has(`y:${g.id}`), stepY ? { x1: bubbleX + 10, y1: y } : undefined),
      );
    }

    // Slab edge dimensions: how far each edge is from its grid line (the cantilevers).
    const corners = slabCorners(floor, "actual");
    if (corners && floor.slab) {
      floor.slab.edges.forEach((edge, i) => {
        const [p, q] = edgeSegment(corners, i);
        const ref = linePos(floor, edge.axis, edge.ref, "actual");
        if (ref === null) return;
        const value = edge.actual ?? edge.design;
        const lenPx = Math.abs(value) * k;
        const segPx = Math.hypot(q[0] - p[0], q[1] - p[1]) * k;
        if (!value || lenPx < 12 || segPx < 26) return;
        const sel: Selection = { kind: "edge", key: edge._key };
        const hot = sameSel(selection, sel);
        const dev = edgeDeviation(floor, edge);
        const cls = hot
          ? `${s.dimText} ${s.dimHot}`
          : dev === null
            ? s.dimText
            : DIM_CLASS[statusFor(Math.abs(dev), tol)];
        const label = mm(Math.abs(value));
        const key = `edim${edge._key}`;
        if (edge.axis === "y") {
          const x = sx((p[0] + q[0]) / 2);
          const y0 = sy(ref);
          const y1 = sy(ref + value);
          if (x < -30 || x > W + 30) return;
          over.push(
            <line key={`${key}l`} x1={x} x2={x} y1={y0} y2={y1} className={s.dimLine} />,
            tick(x, y0, `${key}a`),
            tick(x, y1, `${key}b`),
          );
          over.push(
            <text key={`${key}t`} x={x + 6 + label.length * 3.4} y={(y0 + y1) / 2} className={cls}>
              {label}
            </text>,
          );
          hits.push({ sel, x: x - 8, y: Math.min(y0, y1) - 4, w: 20 + label.length * 7, h: Math.abs(y1 - y0) + 8 });
        } else {
          const y = sy((p[1] + q[1]) / 2);
          const x0 = sx(ref);
          const x1 = sx(ref + value);
          if (y < -30 || y > H + 30) return;
          over.push(
            <line key={`${key}l`} x1={x0} x2={x1} y1={y} y2={y} className={s.dimLine} />,
            tick(x0, y, `${key}a`),
            tick(x1, y, `${key}b`),
          );
          over.push(
            <text key={`${key}t`} x={(x0 + x1) / 2} y={y - 9} className={cls}>
              {label}
            </text>,
          );
          hits.push({ sel, x: Math.min(x0, x1) - 4, y: y - 20, w: Math.abs(x1 - x0) + 8, h: 28 });
        }
      });
    }

    // Gaps between columns, face to face: along every row, and down the line of the chosen column.
    if (k >= 0.012) {
      const chosen =
        selection?.kind === "box" || selection?.kind === "colgap"
          ? (floor[selection.list] as BoxEl[]).find((e) => e._key === selection.key)
          : undefined;
      const drawChain = (axis: "x" | "y", lineId: string) => {
        const gaps = tapeGaps(floor, axis, lineId);
        if (!gaps.length) return;
        // Just outside the row: below its lowest face (or right of a line's furthest face).
        let edge = -Infinity;
        for (const it of chainOf(floor, axis, lineId)) {
          const b = boxOf(floor, it.el, "actual");
          if (b) edge = Math.max(edge, axis === "x" ? b.y1 : b.x1);
        }
        const at = (axis === "x" ? sy(edge) : sx(edge)) + 13;
        for (const g of gaps) {
          const pb = boxOf(floor, g.prev.el, "actual");
          const nb = boxOf(floor, g.next.el, "actual");
          if (!pb || !nb) continue;
          const a = axis === "x" ? sx(pb.x1) : sy(pb.y1);
          const b = axis === "x" ? sx(nb.x0) : sy(nb.y0);
          if (b - a < 30) continue;
          if (
            axis === "x"
              ? b < -10 || a > W + 10 || at < -10 || at > H + 10
              : b < -10 || a > H + 10 || at < -10 || at > W + 10
          )
            continue;
          const sel: Selection = { kind: "colgap", axis, list: g.next.list, key: g.next.el._key };
          const hot = sameSel(selection, sel);
          const cls = hot
            ? `${s.dimText} ${s.dimHot}`
            : g.measured
              ? DIM_CLASS[statusFor(Math.abs(g.actual - g.design), tol)]
              : s.colGapText;
          const label = mm(g.actual);
          const key = `cg${axis}${g.next.el._key}`;
          if (axis === "x") {
            over.push(
              <line key={`${key}l`} x1={a} x2={b} y1={at} y2={at} className={s.colGapLine} />,
              tick(a, at, `${key}a`),
              tick(b, at, `${key}b`),
            );
            if (b - a >= label.length * 6.6 + 8)
              over.push(
                <text key={`${key}t`} x={(a + b) / 2} y={at - 7} className={cls}>
                  {label}
                </text>,
              );
            hits.push({ sel, x: a, y: at - 17, w: b - a, h: 24 });
          } else {
            over.push(
              <line key={`${key}l`} y1={a} y2={b} x1={at} x2={at} className={s.colGapLine} />,
              tick(at, a, `${key}a`),
              tick(at, b, `${key}b`),
            );
            if (b - a >= label.length * 6.6 + 8)
              over.push(
                <text
                  key={`${key}t`}
                  x={at + 8}
                  y={(a + b) / 2}
                  transform={`rotate(-90 ${at + 8} ${(a + b) / 2})`}
                  className={cls}
                >
                  {label}
                </text>,
              );
            hits.push({ sel, x: at - 6, y: a, w: 22, h: b - a });
          }
        }
      };
      for (const id of chainLines(floor, "x")) drawChain("x", id);
      // Zoomed in: down every lettered line too. Further out, only the chosen column's line.
      if (k >= ZOOM_DETAIL) for (const id of chainLines(floor, "y")) drawChain("y", id);
      else if (chosen && "x" in chosen)
        drawChain(
          "y",
          // (a lift core on its own line is measured along the line through it, see chainLineOf)
          selection?.kind !== "edge" && selection?.kind !== "gap" && selection?.list === "cores"
            ? chainLineOf(floor, "y", { list: "cores", el: chosen as CoreEl })
            : chosen.x,
        );
    }

    // Zoomed in: how far each slab edge is from the column face in front of it.
    if (k >= ZOOM_DETAIL) {
      for (const r of edgeReaches(floor)) {
        const across = r.edge.axis === "y";
        const a = across ? sy(r.from) : sx(r.from);
        const b2 = across ? sy(r.to) : sx(r.to);
        if (Math.abs(b2 - a) < 16) continue;
        // A little to one side of the column's middle, clear of its own size.
        const box = boxOf(floor, r.item.el, "actual");
        const half = box ? ((across ? box.x1 - box.x0 : box.y1 - box.y0) * k) / 4 : 0;
        const at = (across ? sx(r.at) : sy(r.at)) + Math.min(12, half);
        if (across ? at < -10 || at > W + 10 : at < -10 || at > H + 10) continue;
        const sel: Selection = { kind: "edge", key: r.edge._key, via: { list: r.item.list, key: r.item.el._key } };
        const hot = sameSel(selection, sel);
        const measured = r.edge.actual !== null && r.edge.actual !== undefined;
        const cls = hot
          ? `${s.dimText} ${s.dimHot}`
          : measured && r.design !== null
            ? DIM_CLASS[statusFor(Math.abs(r.distance - r.design), tol)]
            : s.colGapText;
        const label = mm(r.distance);
        const key = `er${r.edge._key}${r.item.el._key}`;
        const lo = Math.min(a, b2);
        const len = Math.abs(b2 - a);
        if (across) {
          over.push(
            <line key={`${key}l`} x1={at} x2={at} y1={a} y2={b2} className={s.colGapLine} />,
            tick(at, a, `${key}a`),
            tick(at, b2, `${key}b`),
          );
          if (len >= label.length * 6.4 + 6)
            over.push(
              <text
                key={`${key}t`}
                x={at + 8}
                y={lo + len / 2}
                transform={`rotate(-90 ${at + 8} ${lo + len / 2})`}
                className={cls}
              >
                {label}
              </text>,
            );
          hits.push({ sel, x: at - 6, y: lo, w: 22, h: len });
        } else {
          over.push(
            <line key={`${key}l`} x1={a} x2={b2} y1={at} y2={at} className={s.colGapLine} />,
            tick(a, at, `${key}a`),
            tick(b2, at, `${key}b`),
          );
          if (len >= label.length * 6.4 + 6)
            over.push(
              <text key={`${key}t`} x={lo + len / 2} y={at - 7} className={cls}>
                {label}
              </text>,
            );
          hits.push({ sel, x: lo, y: at - 16, w: len, h: 22 });
        }
      }
    }

    // Zoomed right in: every column's width (above it) and depth (to its left).
    if (k >= ZOOM_SIZES) {
      for (const list of ["columns", "cores"] as const) {
        for (const el of floor[list] as BoxEl[]) {
          const b = boxOf(floor, el, "actual");
          if (!b) continue;
          const x0 = sx(b.x0);
          const x1 = sx(b.x1);
          const y0 = sy(b.y0);
          const y1 = sy(b.y1);
          if (x1 < -20 || x0 > W + 20 || y1 < -20 || y0 > H + 20) continue;
          const taped =
            (el as { w?: number | null; h?: number | null }).w != null || (el as { h?: number | null }).h != null;
          const cls = taped ? `${s.dimText} ${s.dimMeasured}` : s.sizeText;
          const sel: Selection = { kind: "box", list, key: el._key };
          const wl = mm(b.x1 - b.x0);
          const hl = mm(b.y1 - b.y0);
          const key = `sz${list}${el._key}`;
          over.push(
            <line key={`${key}w`} x1={x0} x2={x1} y1={y0 - 8} y2={y0 - 8} className={s.sizeLine} />,
            tick(x0, y0 - 8, `${key}wa`),
            tick(x1, y0 - 8, `${key}wb`),
            <line key={`${key}h`} x1={x0 - 8} x2={x0 - 8} y1={y0} y2={y1} className={s.sizeLine} />,
            tick(x0 - 8, y0, `${key}ha`),
            tick(x0 - 8, y1, `${key}hb`),
          );
          if (x1 - x0 >= wl.length * 6 + 4)
            over.push(
              <text key={`${key}wt`} x={(x0 + x1) / 2} y={y0 - 16} className={cls}>
                {wl}
              </text>,
            );
          if (y1 - y0 >= hl.length * 6 + 4)
            over.push(
              <text
                key={`${key}ht`}
                x={x0 - 16}
                y={(y0 + y1) / 2}
                transform={`rotate(-90 ${x0 - 16} ${(y0 + y1) / 2})`}
                className={cls}
              >
                {hl}
              </text>,
            );
          hits.push({ sel, x: x0, y: y0 - 22, w: x1 - x0, h: 16 }, { sel, x: x0 - 22, y: y0, w: 16, h: y1 - y0 });
        }
      }
    }

    // Names of things, once there is room for them.
    if (k >= 0.04) {
      for (const { list, el } of allBoxes(floor)) {
        const b = boxOf(floor, el, "actual");
        if (!b) continue;
        const cx = sx((b.x0 + b.x1) / 2);
        if (list === "columns") {
          const c = el as ColumnEl;
          // A taped size shows next to the type, e.g. "C1 310×600".
          const sized = c.w != null || c.h != null;
          const name = sized && k >= 0.06 ? `${c.name} ${mm(b.x1 - b.x0)}×${mm(b.y1 - b.y0)}` : c.name;
          over.push(
            <text key={`n${el._key}`} x={cx} y={sy(b.y1) + 9} className={s.elLabel}>
              {name}
            </text>,
          );
        } else if ((b.x1 - b.x0) * k > 64 && (b.y1 - b.y0) * k > 22) {
          over.push(
            <text key={`n${el._key}`} x={cx} y={sy((b.y0 + b.y1) / 2)} className={s.elLabel}>
              {el.name}
            </text>,
          );
        }
      }
    }

    // The selected box: how far each face is from its grid lines.
    if (selection?.kind === "box") {
      const el = (floor[selection.list] as BoxEl[]).find((e) => e._key === selection.key);
      const b = el ? boxOf(floor, el, "actual") : null;
      const lx = el ? linePos(floor, "x", el.x, "actual") : null;
      const ly = el ? linePos(floor, "y", el.y, "actual") : null;
      if (el && b && lx !== null && ly !== null) {
        const faceDims = (axis: "x" | "y", line: number, faces: [number, number], at: number) => {
          // Both faces on the same side of the line? Then the two dimensions would overlap: step the second one out.
          const sameSide = Math.sign(faces[0] - line) === Math.sign(faces[1] - line);
          faces.forEach((face, i) => {
            const d = face - line;
            if (Math.abs(d) * k < 8) return;
            const off = at + (sameSide && i === 1 ? 16 : 0);
            const key = `fd${axis}${i}`;
            const label = mm(Math.abs(d));
            if (axis === "x") {
              const y = off;
              over.push(
                <line key={`${key}l`} x1={sx(line)} x2={sx(face)} y1={y} y2={y} className={s.dimLine} />,
                tick(sx(line), y, `${key}a`),
                tick(sx(face), y, `${key}b`),
              );
              over.push(
                <text key={`${key}t`} x={(sx(line) + sx(face)) / 2} y={y - 8} className={`${s.dimText} ${s.dimHot}`}>
                  {label}
                </text>,
              );
            } else {
              const x = off;
              over.push(
                <line key={`${key}l`} x1={x} x2={x} y1={sy(line)} y2={sy(face)} className={s.dimLine} />,
                tick(x, sy(line), `${key}a`),
                tick(x, sy(face), `${key}b`),
              );
              over.push(
                <text
                  key={`${key}t`}
                  x={x + 6 + label.length * 3.4}
                  y={(sy(line) + sy(face)) / 2}
                  className={`${s.dimText} ${s.dimHot}`}
                >
                  {label}
                </text>,
              );
            }
          });
        };
        if (selection.list === "openings") {
          // A void is shown as it is: its own width and depth, and how far it is from the columns around it.
          const x0 = sx(b.x0);
          const x1 = sx(b.x1);
          const y0 = sy(b.y0);
          const y1 = sy(b.y1);
          const hot = `${s.dimText} ${s.dimHot}`;
          over.push(
            <line key="vw" x1={x0} x2={x1} y1={y0 - 12} y2={y0 - 12} className={s.dimLine} />,
            tick(x0, y0 - 12, "vwa"),
            tick(x1, y0 - 12, "vwb"),
            <text key="vwt" x={(x0 + x1) / 2} y={y0 - 21} className={hot}>
              {mm(b.x1 - b.x0)}
            </text>,
            <line key="vh" x1={x0 - 12} x2={x0 - 12} y1={y0} y2={y1} className={s.dimLine} />,
            tick(x0 - 12, y0, "vha"),
            tick(x0 - 12, y1, "vhb"),
            <text
              key="vht"
              x={x0 - 21}
              y={(y0 + y1) / 2}
              transform={`rotate(-90 ${x0 - 21} ${(y0 + y1) / 2})`}
              className={hot}
            >
              {mm(b.y1 - b.y0)}
            </text>,
          );
          for (const n of openingNeighbours(floor, el as OpeningEl)) {
            const across = n.side === "left" || n.side === "right";
            const a = across ? sx(n.from) : sy(n.from);
            const c = across ? sx(n.to) : sy(n.to);
            const at = across ? sy(n.at) : sx(n.at);
            if (Math.abs(c - a) < 10) continue;
            const key = `vn${n.side}`;
            const label = mm(n.distance);
            if (across) {
              over.push(
                <line key={`${key}l`} x1={a} x2={c} y1={at} y2={at} className={s.colGapLine} />,
                tick(a, at, `${key}a`),
                tick(c, at, `${key}b`),
                <text key={`${key}t`} x={(a + c) / 2} y={at - 8} className={hot}>
                  {label}
                </text>,
              );
            } else {
              over.push(
                <line key={`${key}l`} x1={at} x2={at} y1={a} y2={c} className={s.colGapLine} />,
                tick(at, a, `${key}a`),
                tick(at, c, `${key}b`),
                <text
                  key={`${key}t`}
                  x={at + 8}
                  y={(a + c) / 2}
                  transform={`rotate(-90 ${at + 8} ${(a + c) / 2})`}
                  className={hot}
                >
                  {label}
                </text>,
              );
            }
          }
          // Corner handles to drag (resize).
          if (!(el as OpeningEl).removed) {
            for (const [key, cx, cy] of [
              ["htl", x0, y0],
              ["htr", x1, y0],
              ["hbl", x0, y1],
              ["hbr", x1, y1],
            ] as const) {
              over.push(<rect key={key} x={cx - 6} y={cy - 6} width={12} height={12} className={s.handle} />);
            }
          }
        } else {
          faceDims("x", lx, [b.x0, b.x1], sy(b.y1) + 22);
          faceDims("y", ly, [b.y0, b.y1], sx(b.x1) + 18);
        }
      }
    }

    return { under, over, hits };
  }, [view, size.w, size.h, floor, ext, selection, tol, full]);

  // ---- tapping ----
  // On a phone the panel slides up over the bottom of the screen: if the tapped thing would end
  // up under it, slide the plan up so it stays in sight. Waits a moment in case it's a double tap.
  const revealTimer = useRef(0);
  const reveal = useCallback(
    (clientY: number) => {
      if (typeof window === "undefined" || window.innerWidth >= SHEET_BELOW) return;
      window.clearTimeout(revealTimer.current);
      revealTimer.current = window.setTimeout(() => {
        const v = pendingView.current ?? viewRef.current;
        if (!v) return;
        const sheetTop = window.innerHeight * (1 - SHEET_SHARE);
        if (clientY < sheetTop - 40) return;
        const target = Math.max(sheetTop * 0.55, 90);
        queueView({ ...v, y: v.y + (clientY - target) / v.k });
      }, 330);
    },
    [queueView],
  );

  useEffect(() => () => window.clearTimeout(revealTimer.current), []);

  const handleTap = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapRef.current;
      const v = viewRef.current;
      if (!el || !v) return;
      const r = el.getBoundingClientRect();
      const px = clientX - r.left;
      const py = clientY - r.top;
      const mx = v.x + px / v.k;
      const my = v.y + py / v.k;
      if (placing) {
        onPlace(mx, my);
        return;
      }
      for (const h of drawing?.hits ?? []) {
        if (px >= h.x - 4 && px <= h.x + h.w + 4 && py >= h.y - 4 && py <= h.y + h.h + 4) {
          onSelect(h.sel);
          reveal(clientY);
          return;
        }
      }
      // Scores in screen pixels, lowest wins. Columns are small and the most measured, so a
      // column within reach beats a tap that lands just inside a stair, opening or lift core.
      const HANDICAP: Record<BoxList, number> = { columns: 0, cores: 5, openings: 9 };
      let best: { sel: Selection; score: number } | null = null;
      for (const { list, el: item } of allBoxes(floor)) {
        const b = boxOf(floor, item, "actual");
        if (!b) continue;
        const dx = Math.max(b.x0 - mx, 0, mx - b.x1);
        const dy = Math.max(b.y0 - my, 0, my - b.y1);
        const dPx = Math.hypot(dx, dy) * v.k;
        if (dPx > 14) continue;
        // Inside several? The smallest wins.
        const inside = dPx === 0 ? -1 / Math.max((b.x1 - b.x0) * (b.y1 - b.y0), 1) : dPx;
        const score = inside + HANDICAP[list];
        if (!best || score < best.score) best = { sel: { kind: "box", list, key: item._key }, score };
      }
      const corners = slabCorners(floor, "actual");
      if (corners && floor.slab) {
        floor.slab.edges.forEach((edge, i) => {
          const [p, q] = edgeSegment(corners, i);
          const dPx = distToSegment([mx, my], p, q) * v.k;
          if (dPx > 11) return;
          const score = dPx + 3;
          if (!best || score < best.score) best = { sel: { kind: "edge", key: edge._key }, score };
        });
      }
      onSelect(best ? best.sel : null);
      if (best) reveal(clientY);
    },
    [placing, onPlace, onSelect, drawing, floor, reveal],
  );

  // ---- dragging, pinching, tapping ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    t: number;
    moved: boolean;
    start: View;
    pinch?: { d: number; mx: number; my: number };
    /** Dragging the selected void (or one of its corners) instead of moving the plan. */
    move?: { key: string; corner?: Corner };
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const v = viewRef.current;
    if (!v) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      gesture.current = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, start: v };
      // A finger that comes down on the selected void drags the void, not the plan.
      if (selection?.kind === "box" && selection.list === "openings" && !placing) {
        const el = baseFloor.openings.find((o) => o._key === selection.key);
        const b = el && !el.removed ? boxOf(baseFloor, el, "actual") : null;
        if (b) {
          const r = e.currentTarget.getBoundingClientRect();
          const mx = v.x + (e.clientX - r.left) / v.k;
          const my = v.y + (e.clientY - r.top) / v.k;
          const pad = 10 / v.k;
          // A corner handle first (they sit just outside the corners), then the void itself.
          const reach = 16 / v.k;
          const corners: [Corner, number, number][] = [
            ["tl", b.x0, b.y0],
            ["tr", b.x1, b.y0],
            ["bl", b.x0, b.y1],
            ["br", b.x1, b.y1],
          ];
          const hit = corners.find(([, cx, cy]) => Math.hypot(mx - cx, my - cy) <= reach);
          if (hit) gesture.current.move = { key: selection.key, corner: hit[0] };
          else if (mx >= b.x0 - pad && mx <= b.x1 + pad && my >= b.y0 - pad && my <= b.y1 + pad) {
            gesture.current.move = { key: selection.key };
          }
        }
      }
    } else if (pts.length === 2) {
      // A second finger turns a drag into a pinch: put the void back.
      dragRef.current = null;
      setDrag(null);
      const r = e.currentTarget.getBoundingClientRect();
      const [a, b] = pts;
      gesture.current = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        t: 0,
        moved: true,
        start: pendingView.current ?? v,
        pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top },
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.pinch && pts.length >= 2) {
      const r = e.currentTarget.getBoundingClientRect();
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = clamp(g.start.k * (d / (g.pinch.d || 1)), MIN_K, MAX_K);
      const mxNow = (a.x + b.x) / 2 - r.left;
      const myNow = (a.y + b.y) / 2 - r.top;
      const fx = g.start.x + g.pinch.mx / g.start.k;
      const fy = g.start.y + g.pinch.my / g.start.k;
      queueView({ k, x: fx - mxNow / k, y: fy - myNow / k });
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < TAP_MOVE_PX) return;
    g.moved = true;
    if (g.move) {
      const step = dragSnap(g.start.k);
      const next: Drag = {
        key: g.move.key,
        dx: Math.round(dx / g.start.k / step) * step,
        dy: Math.round(dy / g.start.k / step) * step,
        corner: g.move.corner,
      };
      const prev = dragRef.current;
      if (!prev || prev.dx !== next.dx || prev.dy !== next.dy) {
        dragRef.current = next;
        setDrag(next);
      }
      return;
    }
    queueView({ k: g.start.k, x: g.start.x - dx / g.start.k, y: g.start.y - dy / g.start.k });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0 && g?.move && g.moved) {
      // Let go of a dragged void: save where it landed.
      gesture.current = null;
      const d = dragRef.current;
      dragRef.current = null;
      // Saving updates the floor in this same moment, so the preview can go straight away.
      if (d && (d.dx || d.dy)) {
        if (d.corner) {
          const el = baseFloor.openings.find((o) => o._key === d.key);
          const cur = el ? (el.actual ?? el.design) : null;
          if (cur) onResizeOpening(d.key, draggedFaces(cur, d));
        } else onMoveOpening(d.key, d.dx, d.dy);
      }
      setDrag(null);
      return;
    }
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (g && !g.moved && !g.pinch && performance.now() - g.t < TAP_MS) {
        // A second tap straight after the first zooms in there (like a map).
        const now = performance.now();
        const last = lastTap.current;
        if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 32) {
          lastTap.current = null;
          window.clearTimeout(revealTimer.current);
          const r = e.currentTarget.getBoundingClientRect();
          zoomAt(2, e.clientX - r.left, e.clientY - r.top);
          return;
        }
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        handleTap(e.clientX, e.clientY);
      }
    } else if (pointers.current.size === 1 && g?.pinch) {
      // One finger left after a pinch: carry on panning from here.
      const [p] = [...pointers.current.values()];
      const v = pendingView.current ?? viewRef.current;
      if (v) gesture.current = { x: p.x, y: p.y, t: 0, moved: true, start: v };
    }
  };

  const zoomButton = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2);
  const refit = () => {
    pendingView.current = null;
    setUserView(fitView("all"));
  };

  // ---- the drawing itself, in mm ----
  const corners = slabCorners(floor, "actual");
  const designCorners = slabCorners(floor, "design");
  const vb = view && size.w ? `${view.x} ${view.y} ${size.w / view.k} ${size.h / view.k}` : "0 0 1 1";

  const selectedEdgeSeg = (() => {
    if (selection?.kind !== "edge" || !corners || !floor.slab) return null;
    const i = floor.slab.edges.findIndex((e) => e._key === selection.key);
    return i >= 0 ? edgeSegment(corners, i) : null;
  })();

  const boxRect = (b: Box, className: string, key: string) => (
    <rect key={key} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} className={className} />
  );

  const drawOpening = (el: OpeningEl) => {
    const b = boxOf(floor, el, "actual");
    if (!b) return null;
    if (el.removed) return boxRect(b, s.openingRemoved, `o${el._key}`);
    if (el.kind === "pool") return boxRect(b, s.pool, `o${el._key}`);
    const cls = el.added ? s.openingAdded : el.actual ? s.openingMeasured : s.opening;
    if (el.kind === "stair") {
      const treads: ReactNode[] = [];
      const along = b.y1 - b.y0 >= b.x1 - b.x0;
      const len = along ? b.y1 - b.y0 : b.x1 - b.x0;
      for (let t = 260; t < len - 100; t += 260) {
        treads.push(
          along ? (
            <line key={t} x1={b.x0} x2={b.x1} y1={b.y0 + t} y2={b.y0 + t} className={s.thin} />
          ) : (
            <line key={t} y1={b.y0} y2={b.y1} x1={b.x0 + t} x2={b.x0 + t} className={s.thin} />
          ),
        );
      }
      return (
        <g key={`o${el._key}`}>
          {boxRect(b, cls, "r")}
          {treads}
        </g>
      );
    }
    return (
      <g key={`o${el._key}`}>
        {boxRect(b, cls, "r")}
        <line x1={b.x0} y1={b.y0} x2={b.x1} y2={b.y1} className={s.thin} />
        <line x1={b.x1} y1={b.y0} x2={b.x0} y2={b.y1} className={s.thin} />
      </g>
    );
  };

  const drawCore = (el: CoreEl) => {
    const b = boxOf(floor, el, "actual");
    if (!b) return null;
    const wall = (el.actual ?? el.design).wall;
    const inner: Box = { x0: b.x0 + wall, x1: b.x1 - wall, y0: b.y0 + wall, y1: b.y1 - wall };
    const status = boxStatus(floor, el, tol);
    const door = el.door;
    return (
      <g key={`c${el._key}`}>
        {boxRect(b, CORE_CLASS[status], "outer")}
        {boxRect(inner, s.shaft, "inner")}
        {door && door.side === "b" && (
          <rect x={b.x0 + door.from} y={inner.y1 - 1} width={door.width} height={wall + 2} className={s.shaft} />
        )}
        {door && door.side === "t" && (
          <rect x={b.x0 + door.from} y={b.y0 - 1} width={door.width} height={wall + 2} className={s.shaft} />
        )}
        <line x1={inner.x0} y1={inner.y0} x2={inner.x1} y2={inner.y1} className={s.thin} />
        <line x1={inner.x1} y1={inner.y0} x2={inner.x0} y2={inner.y1} className={s.thin} />
      </g>
    );
  };

  const drawColumn = (el: ColumnEl) => {
    const b = boxOf(floor, el, "actual");
    if (!b) return null;
    const status = boxStatus(floor, el, tol);
    const ghost = el.actual ? boxOf(floor, el, "design") : null;
    return (
      <g key={`k${el._key}`}>
        {boxRect(b, el.ends && status === "none" ? `${s.colNone} ${s.colEnds}` : COL_CLASS[status], "b")}
        {ghost && boxRect(ghost, s.designGhost, "g")}
      </g>
    );
  };

  const selectedBox = (() => {
    if (selection?.kind !== "box") return null;
    const el = (floor[selection.list] as BoxEl[]).find((e) => e._key === selection.key);
    return el ? boxOf(floor, el, "actual") : null;
  })();

  const belowBoxes: Box[] = [];
  if (showBelow && below) {
    for (const list of ["columns", "cores"] as BoxList[]) {
      for (const el of below[list] as BoxEl[]) {
        const b = boxOf(below, el, "actual");
        if (b) belowBoxes.push(b);
      }
    }
  }

  return (
    <div>
      <div
        ref={wrapRef}
        className={`${placing ? s.boardPlacing : s.board}${full ? ` ${s.boardFull}` : ""}${drag ? ` ${s.boardDragging}` : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label={`Plan of the ${floor.name}. Drag to move, pinch or scroll to zoom, tap a column, opening, slab edge or dimension to measure it.`}
      >
        <svg className={s.layer} aria-hidden="true">
          {drawing?.under}
        </svg>
        {view && size.w > 0 && (
          <svg className={s.layer} viewBox={vb} preserveAspectRatio="none" aria-hidden="true">
            {corners && <polygon points={corners.map((p) => p.join(",")).join(" ")} className={s.slab} />}
            {designCorners && corners && JSON.stringify(designCorners) !== JSON.stringify(corners) && (
              <polygon points={designCorners.map((p) => p.join(",")).join(" ")} className={s.slabDesign} />
            )}
            {floor.openings.map(drawOpening)}
            {floor.cores.map(drawCore)}
            {floor.columns.map(drawColumn)}
            {belowBoxes.map((b, i) => boxRect(b, s.target, `below${i}`))}
            {selectedEdgeSeg && (
              <line
                x1={selectedEdgeSeg[0][0]}
                y1={selectedEdgeSeg[0][1]}
                x2={selectedEdgeSeg[1][0]}
                y2={selectedEdgeSeg[1][1]}
                className={s.edgeHot}
              />
            )}
            {selectedBox &&
              view &&
              boxRect(
                {
                  x0: selectedBox.x0 - 4 / view.k,
                  x1: selectedBox.x1 + 4 / view.k,
                  y0: selectedBox.y0 - 4 / view.k,
                  y1: selectedBox.y1 + 4 / view.k,
                },
                s.selected,
                "sel",
              )}
          </svg>
        )}
        <svg className={s.layer} aria-hidden="true">
          {drawing?.over}
        </svg>

        {placing && (
          <div className={s.placingBar}>
            Tap where the void is
            <button type="button" className={s.btnOnDark} onClick={onCancelPlace}>
              Cancel
            </button>
          </div>
        )}

        {full && (
          <div className={s.fullBar}>
            <button
              type="button"
              disabled={!floorNav.down}
              onClick={() => floorNav.down && floorNav.go(floorNav.down.key)}
              aria-label={floorNav.down ? `Go down to the ${floorNav.down.name}` : "No floor below"}
            >
              ▼
            </button>
            <span>{floor.name}</span>
            <button
              type="button"
              disabled={!floorNav.up}
              onClick={() => floorNav.up && floorNav.go(floorNav.up.key)}
              aria-label={floorNav.up ? `Go up to the ${floorNav.up.name}` : "No floor above"}
            >
              ▲
            </button>
            <button type="button" className={s.fullDone} onClick={onToggleFull}>
              Done
            </button>
          </div>
        )}
        <div className={s.boardTools}>
          {!placing && floor.slab && (
            <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={onStartPlace}>
              + Void
            </button>
          )}
          {below && (
            <button
              type="button"
              className={`${s.btn} ${s.btnSmall}`}
              onClick={() => setShowBelow((v) => !v)}
              aria-pressed={showBelow}
            >
              {showBelow ? "Hide floor below" : "Show floor below"}
            </button>
          )}
        </div>
        <div className={s.zoom}>
          <button type="button" className={s.iconBtn} onClick={() => zoomButton(1.6)} aria-label="Zoom in">
            +
          </button>
          <button type="button" className={s.iconBtn} onClick={() => zoomButton(1 / 1.6)} aria-label="Zoom out">
            −
          </button>
          <button type="button" className={s.fitBtn} onClick={refit} aria-label="Fit the whole floor">
            Fit
          </button>
          {!full && (
            <button type="button" className={s.iconBtn} onClick={onToggleFull} aria-label="Full screen">
              ⤢
            </button>
          )}
        </div>
      </div>
      <div className={s.legend}>
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ background: "var(--ink)" }} /> Not measured yet
        </span>
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ background: "var(--sage)" }} /> Within {tol.ok} mm
        </span>
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ background: "var(--brass)" }} /> {tol.ok}–{tol.warn} mm off
        </span>
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ background: "var(--clay)" }} /> More than {tol.warn} mm off
        </span>
        {showBelow && (
          <span className={s.legendItem}>
            <span
              className={s.swatch}
              style={{ background: "transparent", borderColor: "var(--clay)", borderStyle: "dashed" }}
            />{" "}
            Floor below
          </span>
        )}
      </div>
    </div>
  );
}
