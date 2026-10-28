"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { boxOf, extentsOf, gridLines, linePos, slabCorners, type Box } from "@/lib/asbuilt/geometry";
import type { Axis, BoxEl, Floor } from "@/lib/asbuilt/types";
import { attachedEnds, makeWall, moveEnd, moveWall, newKey, pointAt, updateLabel, updateOpening } from "@/lib/plans/edit";
import {
  isCommon,
  isOutdoor,
  pointPos,
  reanchor,
  referenceStrips,
  snapLines,
  snapTo,
  wallLines,
  wallRect,
  type P,
  type PlanAnalysis,
  type SnapLine,
  type WallLine,
} from "@/lib/plans/geometry";
import type { Anchor, OpeningKind, PlanContent, PlanOpening, PlanPoint, PlanReference, WallKind } from "@/lib/plans/types";

import s from "./Plans.module.css";

export type Tool = "select" | "wall" | "door" | "window" | "label";
export type Sel = { kind: "wall" | "opening" | "label"; key: string } | { kind: "room"; id: number } | null;

interface View {
  x: number;
  y: number;
  k: number;
}

interface Props {
  floor: Floor;
  plan: PlanContent;
  analysis: PlanAnalysis;
  tool: Tool;
  wallKind: WallKind;
  wallT: number;
  openingKind: OpeningKind;
  openingW: number;
  selection: Sel;
  onSelect: (sel: Sel) => void;
  /** A change still being made (a wall being dragged): shown, not saved. Null ends it. */
  onPreview: (plan: PlanContent | null) => void;
  /** A finished change, saved and undoable. */
  onCommit: (plan: PlanContent, what: string) => void;
  /** Name a room: a new label at this point. */
  onLabelAt: (at: PlanPoint) => void;
  colourOf: (unit: string) => string;
  /** Bring this point into view (a problem, a home). */
  focus: { at: P; n: number } | null;
  /** An architect's plan to trace over, and how strongly it shows (0 = hidden). */
  reference: PlanReference | null;
  referenceShade: number;
}

const MIN_K = 0.004;
const MAX_K = 2;
const SNAP_PX = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (mm: number) => Math.round(mm).toLocaleString("en-GB");

/** An arc of radius r round c, from p0 to p1 (the short way). */
function arcPath(c: P, p0: P, p1: P, r: number): string {
  const cross = (p0[0] - c[0]) * (p1[1] - c[1]) - (p0[1] - c[1]) * (p1[0] - c[0]);
  return `M${p0[0]} ${p0[1]} A${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${p1[0]} ${p1[1]}`;
}

/** The wall's centre line on the nearest line: centred on it, or with either face on it. */
function snapCentre(lines: SnapLine[], axis: Axis, v: number, reach: number, t: number): SnapLine | null {
  const options = [0, -t / 2, t / 2].map((off) => snapTo(lines, axis, v, reach, off)).filter((x): x is SnapLine => Boolean(x));
  return options.sort((a, b) => Math.abs(a.v - v) - Math.abs(b.v - v))[0] ?? null;
}

/** The end of a wall, square to the grid: a point hung on what it snapped to. */
function snapPoint(floor: Floor, lines: SnapLine[], p: P, reach: number): { pos: P; pt: PlanPoint; hint: string } {
  const sx = snapTo(lines, "x", p[0], reach);
  const sy = snapTo(lines, "y", p[1], reach);
  const pos: P = [sx ? sx.v : r1(p[0]), sy ? sy.v : r1(p[1])];
  const base = pointAt(floor, pos);
  return {
    pos,
    pt: { x: sx ? sx.anchor : base.x, y: sy ? sy.anchor : base.y },
    hint: [sx?.what, sy?.what].filter(Boolean).join(" · "),
  };
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean }
  | { kind: "wall"; key: string; start: P; along: Axis; attached: { wall: string; end: "a" | "b" }[]; moved: boolean; base: PlanContent; lines: SnapLine[] }
  | { kind: "end"; key: string; end: "a" | "b"; moved: boolean; base: PlanContent; lines: SnapLine[] }
  | { kind: "opening"; key: string; moved: boolean; base: PlanContent }
  | { kind: "label"; key: string; moved: boolean; base: PlanContent };

export function PlanCanvas(props: Props) {
  const { floor, plan, analysis, tool, wallKind, wallT, openingKind, openingW, selection, onSelect, onPreview, onCommit, onLabelAt, colourOf, focus, reference, referenceShade } =
    props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [userView, setUserView] = useState<View | null>(null);
  const [hover, setHover] = useState<P | null>(null);
  // The wall being drawn: where it started (the chain carries on from each end).
  const [start, setStart] = useState<{ pos: P; pt: PlanPoint } | null>(null);
  const [typed, setTyped] = useState("");
  const [hint, setHint] = useState("");
  const dragRef = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, P>());
  const pinch = useRef<{ dist: number; view: View; mid: P } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ext = useMemo(() => extentsOf(floor), [floor]);
  const strips = useMemo(() => (reference ? referenceStrips(floor, reference) : []), [floor, reference]);
  const fitted = useMemo<View | null>(() => {
    if (!size.w || !size.h) return null;
    const pad = 60;
    const k = clamp(Math.min((size.w - pad * 2) / (ext.x1 - ext.x0 || 1), (size.h - pad * 2) / (ext.y1 - ext.y0 || 1)), MIN_K, MAX_K);
    return { k, x: ext.x0 - (size.w - (ext.x1 - ext.x0) * k) / 2 / k, y: ext.y0 - (size.h - (ext.y1 - ext.y0) * k) / 2 / k };
  }, [size.w, size.h, ext]);
  const view = userView ?? fitted;

  // Bring a point into view when asked (a problem, a home).
  const lastFocus = useRef(0);
  useEffect(() => {
    if (!focus || !view || focus.n === lastFocus.current) return;
    lastFocus.current = focus.n;
    const k = Math.max(view.k, 0.06);
    setUserView({ k, x: focus.at[0] - size.w / 2 / k, y: focus.at[1] - size.h / 2 / k });
  }, [focus, view, size.w, size.h]);

  const toMm = useCallback(
    (clientX: number, clientY: number): P | null => {
      const el = wrapRef.current;
      if (!el || !view) return null;
      // From the drawing's own corner: inside the board's border.
      const r = el.getBoundingClientRect();
      return [view.x + (clientX - r.left - el.clientLeft) / view.k, view.y + (clientY - r.top - el.clientTop) / view.k];
    },
    [view],
  );

  const zoomAt = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const el = wrapRef.current;
      if (!el || !view) return;
      const r = el.getBoundingClientRect();
      const px = clientX - r.left - el.clientLeft;
      const py = clientY - r.top - el.clientTop;
      const k = clamp(view.k * factor, MIN_K, MAX_K);
      const mx = view.x + px / view.k;
      const my = view.y + py / view.k;
      setUserView({ k, x: mx - px / k, y: my - py / k });
    },
    [view],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const lines = useMemo(() => snapLines(floor, plan), [floor, plan]);
  const reach = view ? SNAP_PX / view.k : 100;

  // ---- drawing walls ----------------------------------------------------------------------------
  const wallEndFor = useCallback(
    (raw: P): { pos: P; pt: PlanPoint; hint: string } | null => {
      if (!start) return null;
      const across = Math.abs(raw[0] - start.pos[0]) >= Math.abs(raw[1] - start.pos[1]);
      const axis: Axis = across ? "x" : "y";
      const i = across ? 0 : 1;
      let v = raw[i];
      let anchor: Anchor | null = null;
      let what = "";
      const len = Number(typed.replace(/[^\d.]/g, ""));
      if (typed && len > 0) {
        v = start.pos[i] + Math.sign(raw[i] - start.pos[i] || 1) * len;
      } else {
        const sn = snapTo(lines, axis, v, reach);
        if (sn) {
          v = sn.v;
          anchor = sn.anchor;
          what = sn.what;
        } else v = r1(v);
      }
      const pos: P = across ? [v, start.pos[1]] : [start.pos[0], v];
      const pt: PlanPoint = across
        ? { x: anchor ?? reanchor(floor, "x", start.pt.x, v), y: start.pt.y }
        : { x: start.pt.x, y: anchor ?? reanchor(floor, "y", start.pt.y, v) };
      return { pos, pt, hint: what };
    },
    [start, typed, lines, reach, floor],
  );

  const finishWall = useCallback(
    (end: { pos: P; pt: PlanPoint }) => {
      if (!start) return;
      if (Math.hypot(end.pos[0] - start.pos[0], end.pos[1] - start.pos[1]) < 20) {
        setStart(null);
        return;
      }
      const wall = makeWall(start.pt, end.pt, start.pos, end.pos, wallKind, wallT);
      onCommit({ ...plan, walls: [...plan.walls, wall] }, "Wall drawn");
      setStart({ pos: end.pos, pt: end.pt });
      setTyped("");
    },
    [start, wallKind, wallT, plan, onCommit],
  );

  // Keys while drawing: a typed length, Enter, Escape.
  useEffect(() => {
    if (tool !== "wall") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        setStart(null);
        setTyped("");
      } else if (start && /^[0-9.]$/.test(e.key)) {
        setTyped((t) => (t + e.key).slice(0, 7));
        e.preventDefault();
      } else if (start && e.key === "Backspace") {
        setTyped((t) => t.slice(0, -1));
        e.preventDefault();
      } else if (start && e.key === "Enter" && hover) {
        const end = wallEndFor(hover);
        if (end) finishWall(end);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, start, hover, wallEndFor, finishWall]);

  // Leaving the wall tool stops the wall being drawn.
  const [toolWas, setToolWas] = useState(tool);
  if (toolWas !== tool) {
    setToolWas(tool);
    if (tool !== "wall") {
      setStart(null);
      setTyped("");
    }
  }

  // ---- what is under the pointer ----------------------------------------------------------------
  const wallsByKey = useMemo(() => new Map(analysis.walls.map((w) => [w.key, w])), [analysis.walls]);

  const nearestWall = useCallback(
    (p: P, within: number): WallLine | null => {
      let best: WallLine | null = null;
      let bestD = within;
      for (const w of analysis.walls) {
        const [along, across] = w.dir === "h" ? [p[0], p[1]] : [p[1], p[0]];
        if (along < w.s0 - within || along > w.s1 + within) continue;
        const d = Math.max(0, Math.abs(across - w.c) - w.t / 2);
        if (d <= bestD) {
          best = w;
          bestD = d;
        }
      }
      return best;
    },
    [analysis.walls],
  );

  const roomAt = useCallback(
    (p: P) => {
      for (const room of analysis.rooms) {
        let inside = false;
        for (const loop of room.loops) {
          for (let i = 0, j = loop.length - 1; i < loop.length; j = i, i += 1) {
            const [xi, yi] = loop[i];
            const [xj, yj] = loop[j];
            if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
          }
        }
        if (inside) return room;
      }
      return null;
    },
    [analysis.rooms],
  );

  const openingAt = useCallback(
    (p: P, within: number): PlanOpening | null => {
      for (const o of plan.openings) {
        const w = wallsByKey.get(o.wall);
        if (!w) continue;
        const sAt = w.aFirst ? w.s0 + o.at : w.s1 - o.at;
        const [along, across] = w.dir === "h" ? [p[0], p[1]] : [p[1], p[0]];
        if (Math.abs(across - w.c) <= w.t / 2 + within && Math.abs(along - sAt) <= o.w / 2) return o;
      }
      return null;
    },
    [plan.openings, wallsByKey],
  );

  const labelAt = useCallback(
    (p: P, within: number) => {
      for (const l of plan.labels) {
        const at = pointPos(floor, l.at);
        if (at && Math.abs(at[0] - p[0]) < within * 2.5 && Math.abs(at[1] - p[1]) < within) return l;
      }
      return null;
    },
    [plan.labels, floor],
  );

  // ---- pointer handling -------------------------------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!view) return;
    const p = toMm(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), view, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      dragRef.current = null;
      return;
    }
    const within = 8 / view.k;
    const pan = (): Drag => ({ kind: "pan", startX: e.clientX, startY: e.clientY, view, moved: false });

    if (e.button === 1 || e.button === 2) {
      dragRef.current = pan();
      return;
    }
    if (tool === "wall") {
      if (!start) {
        const sp = snapPoint(floor, lines, p, reach);
        setStart({ pos: sp.pos, pt: sp.pt });
      } else {
        const end = wallEndFor(p);
        if (end) finishWall(end);
      }
      return;
    }
    if (tool === "door" || tool === "window") {
      const w = nearestWall(p, within * 2);
      if (!w) {
        dragRef.current = pan();
        return;
      }
      const along = w.dir === "h" ? p[0] : p[1];
      const width = openingW;
      const centre = clamp(along, w.s0 + width / 2, w.s1 - width / 2);
      const at = r1(Math.round((w.aFirst ? centre - w.s0 : w.s1 - centre) / 10) * 10);
      const kind: OpeningKind = tool === "window" ? "window" : openingKind;
      const opening: PlanOpening = { _key: newKey("o"), wall: w.key, at, w: width, kind };
      onCommit({ ...plan, openings: [...plan.openings, opening] }, kind === "window" ? "Window added" : "Door added");
      onSelect({ kind: "opening", key: opening._key });
      return;
    }
    if (tool === "label") {
      const room = roomAt(p);
      if (room?.label) onSelect({ kind: "label", key: room.label._key });
      else if (room) onLabelAt(pointAt(floor, p));
      return;
    }
    // Select: a label, an opening, a wall end, a wall, a room; else the plan pans.
    const label = labelAt(p, within);
    if (label) {
      onSelect({ kind: "label", key: label._key });
      dragRef.current = { kind: "label", key: label._key, moved: false, base: plan };
      return;
    }
    const opening = openingAt(p, within);
    if (opening) {
      onSelect({ kind: "opening", key: opening._key });
      dragRef.current = { kind: "opening", key: opening._key, moved: false, base: plan };
      return;
    }
    if (selection?.kind === "wall") {
      const w = wallsByKey.get(selection.key);
      if (w) {
        for (const end of ["a", "b"] as const) {
          const sAt = (end === "a") === w.aFirst ? w.s0 : w.s1;
          const ep: P = w.dir === "h" ? [sAt, w.c] : [w.c, sAt];
          if (Math.hypot(ep[0] - p[0], ep[1] - p[1]) < 12 / view.k) {
            dragRef.current = { kind: "end", key: w.key, end, moved: false, base: plan, lines: snapLines(floor, plan, w.key) };
            return;
          }
        }
      }
    }
    const w = nearestWall(p, within);
    if (w) {
      onSelect({ kind: "wall", key: w.key });
      dragRef.current = {
        kind: "wall",
        key: w.key,
        start: p,
        along: w.dir === "h" ? "y" : "x",
        attached: attachedEnds(floor, plan, w.key),
        moved: false,
        base: plan,
        lines: snapLines(floor, plan, w.key),
      };
      return;
    }
    const room = roomAt(p);
    onSelect(room ? (room.label ? { kind: "label", key: room.label._key } : { kind: "room", id: room.id }) : null);
    dragRef.current = pan();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!view) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const { view: v0, dist: d0, mid } = pinch.current;
      const box = wrapRef.current!;
      const el = box.getBoundingClientRect();
      const left = el.left + box.clientLeft;
      const top = el.top + box.clientTop;
      const k = clamp((v0.k * dist) / d0, MIN_K, MAX_K);
      const mx = v0.x + (mid[0] - left) / v0.k;
      const my = v0.y + (mid[1] - top) / v0.k;
      const nm: P = [(a[0] + b[0]) / 2 - left, (a[1] + b[1]) / 2 - top];
      setUserView({ k, x: mx - nm[0] / k, y: my - nm[1] / k });
      return;
    }
    const p = toMm(e.clientX, e.clientY);
    if (!p) return;
    setHover(p);
    const drag = dragRef.current;
    if (!drag) {
      if (tool === "wall" && !start) setHint(snapPoint(floor, lines, p, reach).hint);
      else if (tool === "wall" && start) setHint(wallEndFor(p)?.hint ?? "");
      return;
    }
    if (drag.kind === "pan") {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      setUserView({ ...drag.view, x: drag.view.x - dx / drag.view.k, y: drag.view.y - dy / drag.view.k });
      return;
    }
    if (drag.kind === "wall") {
      const w = wallLines(floor, drag.base).find((x) => x.key === drag.key);
      if (!w) return;
      const i = drag.along === "x" ? 0 : 1;
      const raw = w.c + (p[i] - drag.start[i]);
      if (!drag.moved && Math.abs(p[i] - drag.start[i]) < 4 / view.k) return;
      drag.moved = true;
      const sn = snapCentre(drag.lines, drag.along, raw, reach, w.t);
      const baseWall = drag.base.walls.find((x) => x._key === drag.key)!;
      const anchor = sn ? sn.anchor : reanchor(floor, drag.along, drag.along === "x" ? baseWall.a.x : baseWall.a.y, r1(raw));
      setHint(sn?.what ?? "");
      onPreview(moveWall(drag.base, floor, drag.key, anchor, drag.attached));
      return;
    }
    if (drag.kind === "end") {
      const w = wallLines(floor, drag.base).find((x) => x.key === drag.key);
      if (!w) return;
      const axis: Axis = w.dir === "h" ? "x" : "y";
      const v = axis === "x" ? p[0] : p[1];
      drag.moved = true;
      const sn = snapTo(drag.lines, axis, v, reach);
      const baseWall = drag.base.walls.find((x) => x._key === drag.key)!;
      const anchor = sn ? sn.anchor : reanchor(floor, axis, baseWall[drag.end][axis], r1(v));
      setHint(sn?.what ?? "");
      onPreview(moveEnd(drag.base, floor, drag.key, drag.end, anchor));
      return;
    }
    if (drag.kind === "opening") {
      const o = drag.base.openings.find((x) => x._key === drag.key);
      const w = o ? wallsByKey.get(o.wall) : undefined;
      if (!o || !w) return;
      const along = w.dir === "h" ? p[0] : p[1];
      const centre = clamp(along, w.s0 + o.w / 2, w.s1 - o.w / 2);
      drag.moved = true;
      onPreview(updateOpening(drag.base, drag.key, { at: r1(Math.round((w.aFirst ? centre - w.s0 : w.s1 - centre) / 10) * 10) }));
      return;
    }
    if (drag.kind === "label") {
      drag.moved = true;
      onPreview(updateLabel(drag.base, drag.key, { at: pointAt(floor, p) }));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.kind === "pan") return;
    setHint("");
    if (!drag.moved) {
      onPreview(null);
      return;
    }
    // The preview becomes the change.
    onPreview(null);
    onCommit(plan, drag.kind === "wall" ? "Wall moved" : drag.kind === "end" ? "Wall lengthened" : drag.kind === "opening" ? "Door moved" : "Room name moved");
  };

  // ---- drawing ----------------------------------------------------------------------------------
  if (!view) return <div ref={wrapRef} className={s.canvas} />;
  const { k } = view;
  const sx = (x: number) => (x - view.x) * k;
  const sy = (y: number) => (y - view.y) * k;
  const W = size.w;
  const H = size.h;
  const stroke = 1 / k;
  const dash = [9, 5, 2, 5].map((v) => v / k).join(" ");

  const slab = slabCorners(floor, "actual");
  const xLines = gridLines(floor, "x");
  const yLines = gridLines(floor, "y");
  const preview = tool === "wall" && start && hover ? wallEndFor(hover) : null;
  const previewRect: Box | null = preview && start
    ? (() => {
        const across = Math.abs(preview.pos[0] - start.pos[0]) >= Math.abs(preview.pos[1] - start.pos[1]);
        const [a, b] = across ? [start.pos[0], preview.pos[0]] : [start.pos[1], preview.pos[1]];
        const c = across ? start.pos[1] : start.pos[0];
        return across
          ? { x0: Math.min(a, b), x1: Math.max(a, b), y0: c - wallT / 2, y1: c + wallT / 2 }
          : { x0: c - wallT / 2, x1: c + wallT / 2, y0: Math.min(a, b), y1: Math.max(a, b) };
      })()
    : null;
  const selWall = selection?.kind === "wall" ? wallsByKey.get(selection.key) : undefined;
  const selRoomId =
    selection?.kind === "room" ? selection.id : selection?.kind === "label" ? analysis.rooms.find((r) => r.label?._key === selection.key)?.id : undefined;

  const pathOf = (loops: P[][]) => loops.map((l) => `M${l.map(([x, y]) => `${r1(x)} ${r1(y)}`).join("L")}Z`).join("");
  const home = (unit: string | null | undefined) => (unit ? analysis.homes.find((h) => h.unit === unit) : undefined);

  return (
    <div
      ref={wrapRef}
      className={`${s.canvas} ${tool === "wall" ? s.drawing : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={() => {
        if (tool === "wall") {
          setStart(null);
          setTyped("");
        }
      }}
    >
      <svg width={W} height={H} className={s.svg} role="img" aria-label="Floor plan">
        <g transform={`translate(${-view.x * k} ${-view.y * k}) scale(${k})`}>
          {slab && <polygon points={slab.map(([x, y]) => `${x},${y}`).join(" ")} className={s.slab} strokeWidth={stroke} />}

          {/* The architect's plan, laid on the as-built grid, to trace over. */}
          {reference && referenceShade > 0 && (
            <g opacity={referenceShade}>
              <defs>
                {strips.map((st, i) => (
                  <clipPath key={i} id={`refclip${i}`}>
                    <rect x={st.clip.x0} y={st.clip.y0} width={st.clip.x1 - st.clip.x0} height={st.clip.y1 - st.clip.y0} />
                  </clipPath>
                ))}
              </defs>
              {strips.map((st, i) => (
                <image
                  key={i}
                  href={reference.url}
                  x={st.image.x}
                  y={st.image.y}
                  width={st.image.w}
                  height={st.image.h}
                  preserveAspectRatio="none"
                  clipPath={`url(#refclip${i})`}
                />
              ))}
            </g>
          )}

          {/* Rooms, coloured by home. */}
          {analysis.rooms.map((room) => {
            const l = room.label;
            const fill = !l ? "transparent" : isCommon(l.type) ? "var(--plan-common)" : isOutdoor(l.type) ? "var(--plan-outdoor)" : l.unit ? colourOf(l.unit) : "var(--plan-unhomed)";
            return (
              <path
                key={`r${room.id}`}
                d={pathOf(room.loops)}
                fill={fill}
                fillRule="evenodd"
                className={room.id === selRoomId ? s.roomOn : s.room}
                strokeWidth={stroke * 2}
              />
            );
          })}
          {/* Each home's net internal area: the inside face of its enclosing walls. */}
          {analysis.homes.map((h) => (
            <path key={`h${h.unit}`} d={pathOf(h.loops)} fill="none" className={s.homeEdge} stroke={colourOf(h.unit)} strokeWidth={stroke * 1.5} fillRule="evenodd" />
          ))}

          {xLines.map((g) => {
            const x = linePos(floor, "x", g.id, "actual");
            return x === null ? null : <line key={`gx${g.id}`} x1={x} x2={x} y1={ext.y0 - 2500} y2={ext.y1 + 2500} className={s.grid} strokeWidth={stroke} strokeDasharray={dash} />;
          })}
          {yLines.map((g) => {
            const y = linePos(floor, "y", g.id, "actual");
            return y === null ? null : <line key={`gy${g.id}`} y1={y} y2={y} x1={ext.x0 - 2500} x2={ext.x1 + 2500} className={s.grid} strokeWidth={stroke} strokeDasharray={dash} />;
          })}

          {/* The structure, as built. */}
          {floor.openings
            .filter((o) => !o.removed)
            .map((o) => {
              const b = boxOf(floor, o, "actual");
              return b ? (
                <g key={`v${o._key}`} className={s.void}>
                  <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} strokeWidth={stroke} />
                  <line x1={b.x0} y1={b.y0} x2={b.x1} y2={b.y1} strokeWidth={stroke} />
                  <line x1={b.x1} y1={b.y0} x2={b.x0} y2={b.y1} strokeWidth={stroke} />
                </g>
              ) : null;
            })}
          {(["cores", "columns"] as const).map((list) =>
            (floor[list] as BoxEl[]).map((el) => {
              const b = boxOf(floor, el, "actual");
              return b ? (
                <rect key={`${list}${el._key}`} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} className={list === "cores" ? s.core : s.column} strokeWidth={stroke} />
              ) : null;
            }),
          )}

          {/* Walls. */}
          {analysis.walls.map((w) => {
            const b = wallRect(w, analysis.walls);
            return (
              <rect
                key={`w${w.key}`}
                x={b.x0}
                y={b.y0}
                width={b.x1 - b.x0}
                height={b.y1 - b.y0}
                className={`${s[`wall_${w.kind}`]} ${selWall?.key === w.key ? s.wallOn : ""}`}
                strokeWidth={stroke}
              />
            );
          })}

          {/* Doors and windows. */}
          {plan.openings.map((o) => {
            const w = wallsByKey.get(o.wall);
            if (!w) return null;
            const centre = w.aFirst ? w.s0 + o.at : w.s1 - o.at;
            const a = centre - o.w / 2;
            const b = centre + o.w / 2;
            const t = w.t + 2;
            const on = selection?.kind === "opening" && selection.key === o._key;
            const cut = w.dir === "h" ? { x: a, y: w.c - t / 2, width: o.w, height: t } : { x: w.c - t / 2, y: a, width: t, height: o.w };
            const side = o.flip ? 1 : -1;
            const hinge = o.hand ? b : a;
            const far = o.hand ? a : b;
            const leaf = o.w * (o.kind === "double" ? 0.5 : 1);
            const faceC = w.c + (side * w.t) / 2;
            const pt = (along: number, across: number): P => (w.dir === "h" ? [along, across] : [across, along]);
            const arc = (h: number, dirSign: number) =>
              arcPath(pt(h, faceC), pt(h, faceC + side * leaf), pt(h + dirSign * leaf, faceC), leaf);
            const leafLine = (h: number) =>
              w.dir === "h" ? { x1: h, y1: faceC, x2: h, y2: faceC + side * leaf } : { x1: faceC, y1: h, x2: faceC + side * leaf, y2: h };
            return (
              <g key={`o${o._key}`} className={on ? s.openingOn : s.opening}>
                <rect {...cut} className={s.cut} />
                {o.kind === "window" || o.kind === "slider" ? (
                  w.dir === "h" ? (
                    <>
                      <line x1={a} x2={b} y1={w.c - (o.kind === "slider" ? w.t / 6 : 0)} y2={w.c - (o.kind === "slider" ? w.t / 6 : 0)} strokeWidth={stroke * 1.4} />
                      <line x1={a} x2={b} y1={w.c + w.t / 6} y2={w.c + w.t / 6} strokeWidth={stroke * 1.4} />
                    </>
                  ) : (
                    <>
                      <line y1={a} y2={b} x1={w.c - (o.kind === "slider" ? w.t / 6 : 0)} x2={w.c - (o.kind === "slider" ? w.t / 6 : 0)} strokeWidth={stroke * 1.4} />
                      <line y1={a} y2={b} x1={w.c + w.t / 6} x2={w.c + w.t / 6} strokeWidth={stroke * 1.4} />
                    </>
                  )
                ) : (
                  <>
                    <line {...leafLine(hinge)} strokeWidth={stroke * 1.6} />
                    <path d={arc(hinge, hinge === a ? 1 : -1)} fill="none" strokeWidth={stroke} />
                    {o.kind === "double" && (
                      <>
                        <line {...leafLine(far)} strokeWidth={stroke * 1.6} />
                        <path d={arc(far, far === a ? 1 : -1)} fill="none" strokeWidth={stroke} />
                      </>
                    )}
                  </>
                )}
              </g>
            );
          })}

          {previewRect && <rect x={previewRect.x0} y={previewRect.y0} width={previewRect.x1 - previewRect.x0} height={previewRect.y1 - previewRect.y0} className={s.wallPreview} strokeWidth={stroke} />}
        </g>

        {/* In screen pixels: names, areas, handles, the length of the wall being drawn. */}
        {xLines.map((g) => {
          const x = linePos(floor, "x", g.id, "actual");
          if (x === null || sx(x) < 10 || sx(x) > W - 10) return null;
          return (
            <g key={`bx${g.id}`} className={s.bubble}>
              <circle cx={sx(x)} cy={16} r={10} />
              <text x={sx(x)} y={16.5}>
                {g.id}
              </text>
            </g>
          );
        })}
        {yLines.map((g) => {
          const y = linePos(floor, "y", g.id, "actual");
          if (y === null || sy(y) < 10 || sy(y) > H - 10) return null;
          return (
            <g key={`by${g.id}`} className={s.bubble}>
              <circle cx={16} cy={sy(y)} r={10} />
              <text x={16} y={sy(y) + 0.5}>
                {g.id}
              </text>
            </g>
          );
        })}

        {analysis.rooms.map((room) => {
          const l = room.label;
          const at = l ? (pointPos(floor, l.at) ?? room.spot) : room.spot;
          const big = room.area >= 1.5;
          if (!big || k * Math.sqrt(room.area) * 1000 < 34) return null;
          // What isn't drawn yet (the rest of the floor) needs no name.
          if (!l && room.area > 150) return null;
          // Only where the words fit inside the room.
          const wPx = (room.box.x1 - room.box.x0) * k;
          const hPx = (room.box.y1 - room.box.y0) * k;
          const name = l ? l.name : "Unnamed";
          if (wPx < Math.max(name.length * 6.6, 46) + 8 || hPx < 34) return null;
          const h = home(l?.unit);
          const isMain = h && h.rooms[0]?.id === room.id && wPx >= `${h.unit} · 00.0 m²`.length * 7.5 && hPx >= 58;
          return (
            <g key={`t${room.id}`} className={s.roomText}>
              {isMain && h && k > 0.012 && (
                <text x={sx(at[0])} y={sy(at[1]) - 26} className={s.homeText}>
                  {h.unit} · {h.nia.toFixed(1)} m²
                </text>
              )}
              <text x={sx(at[0])} y={sy(at[1]) - 6} className={l ? s.roomName : s.roomNameless}>
                {l ? l.name : "Unnamed"}
              </text>
              <text x={sx(at[0])} y={sy(at[1]) + 10} className={s.roomArea}>
                {room.area.toFixed(2)} m²
              </text>
            </g>
          );
        })}

        {selWall && (
          <>
            {(["a", "b"] as const).map((end) => {
              const sAt = (end === "a") === selWall.aFirst ? selWall.s0 : selWall.s1;
              const ep: P = selWall.dir === "h" ? [sAt, selWall.c] : [selWall.c, sAt];
              return <circle key={end} cx={sx(ep[0])} cy={sy(ep[1])} r={6} className={s.handle} />;
            })}
            <text
              x={sx(selWall.dir === "h" ? selWall.s0 + (selWall.s1 - selWall.s0) * 0.25 : selWall.c) + (selWall.dir === "v" ? 22 : 0)}
              y={sy(selWall.dir === "h" ? selWall.c : selWall.s0 + (selWall.s1 - selWall.s0) * 0.25) - (selWall.dir === "h" ? 14 : 0)}
              className={s.dimText}
            >
              {fmt(selWall.s1 - selWall.s0)}
            </text>
          </>
        )}

        {tool === "wall" && start && (
          <circle cx={sx(start.pos[0])} cy={sy(start.pos[1])} r={4} className={s.handle} />
        )}
        {preview && start && (
          <text x={sx((start.pos[0] + preview.pos[0]) / 2)} y={sy((start.pos[1] + preview.pos[1]) / 2) - 14} className={s.dimText}>
            {typed ? `${typed} ⏎` : fmt(Math.hypot(preview.pos[0] - start.pos[0], preview.pos[1] - start.pos[1]))}
          </text>
        )}
      </svg>
      {hint && hover && <div className={s.hint}>lined up on {hint}</div>}
      <div className={s.zoom}>
        <button type="button" onClick={() => wrapRef.current && zoomAt(1.4, wrapRef.current.getBoundingClientRect().left + W / 2, wrapRef.current.getBoundingClientRect().top + H / 2)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => wrapRef.current && zoomAt(1 / 1.4, wrapRef.current.getBoundingClientRect().left + W / 2, wrapRef.current.getBoundingClientRect().top + H / 2)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setUserView(null)}>
          Fit
        </button>
      </div>
      {tool === "wall" && (
        <div className={s.toolTip}>
          {start ? "Click where the wall ends · type a length and press Enter · Esc or double-click to stop" : "Click where the wall starts"}
        </div>
      )}
    </div>
  );
}
