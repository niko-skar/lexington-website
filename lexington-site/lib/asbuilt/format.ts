import type { Axis, BoxEl, BoxList, ColumnEl, OpeningKind } from "./types";

/** Whole millimetres, the way the drawings write them (no separators). */
export function mm(v: number): string {
  const r = Math.round(v);
  return `${Object.is(r, -0) ? 0 : r}`;
}

/** +12 / −8 / 0, for differences from the drawing. */
export function signedMm(v: number): string {
  const r = Math.round(v);
  if (r === 0) return "0";
  return r > 0 ? `+${r}` : `−${Math.abs(r)}`;
}

/** Which side of a grid line a signed offset is on, in words. */
export function sideWord(axis: Axis, v: number): string {
  if (axis === "x") return v < 0 ? "left of" : "right of";
  return v < 0 ? "above" : "below";
}

/** "300 left of grid D", "on grid D" */
export function offsetText(axis: Axis, v: number, line: string): string {
  const r = Math.round(v);
  if (r === 0) return `on grid ${line}`;
  return `${Math.abs(r)} ${sideWord(axis, r)} grid ${line}`;
}

/** How a box moved from the drawing, in words: "12 right, 5 up". */
export function moveText(dx: number, dy: number): string {
  const parts: string[] = [];
  const rx = Math.round(dx);
  const ry = Math.round(dy);
  if (rx) parts.push(`${Math.abs(rx)} ${rx > 0 ? "right" : "left"}`);
  if (ry) parts.push(`${Math.abs(ry)} ${ry > 0 ? "down" : "up"}`);
  return parts.length ? parts.join(", ") : "on the drawing";
}

export const KIND_LABEL: Record<OpeningKind, string> = {
  void: "Void",
  duct: "Duct",
  stair: "Stair",
  pool: "Pool",
};

export function gridRef(el: { x: string; y: string }): string {
  return `${el.x}/${el.y}`;
}

export function boxTitle(list: BoxList, el: BoxEl): string {
  if (list === "columns") {
    const c = el as ColumnEl;
    return `${c.name} at ${gridRef(c)}`;
  }
  return el.name;
}

export function boxKindWord(list: BoxList, el: BoxEl): string {
  if (list === "columns") return (el as ColumnEl).kind === "wall" ? "Wall" : "Column";
  if (list === "cores") return "Lift core";
  return KIND_LABEL[(el as { kind: OpeningKind }).kind] ?? "Opening";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "15 Oct, 14:32" in Ghana time (GMT, no daylight saving). */
export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mi}`;
}

export function dayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
