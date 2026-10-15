/**
 * The as-built record (Niko, 15 Oct 2026): for every floor, what the drawings
 * say ("design") and what was actually built ("actual"), measured in mm.
 *
 * Positions are always relative to the grid. x runs left to right from grid B,
 * y runs down the page from grid 2 (the drawings' own orientation). A box
 * (column, wall, lift core, opening) is four faces, each a signed distance
 * from its own grid lines: l/r from line `x`, t/b from line `y` (negative =
 * left of / above the line). That is exactly how the site sets them out: tape
 * from the string line to each face.
 */

export type Axis = "x" | "y";

export interface Faces {
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface CoreFaces extends Faces {
  /** Wall thickness. The lift shaft inside is the outer box less two walls. */
  wall: number;
}

export interface GridLine {
  _key: string;
  id: string;
  axis: Axis;
  /** Position on the drawing, mm from grid B (x) or grid 2 (y). */
  design: number;
  /** How far the line actually is from where the drawing puts it (as-built). */
  shift?: number | null;
  /** True once the gap from the previous line has been measured on site. */
  measured?: boolean | null;
}

export interface SlabEdge {
  _key: string;
  axis: Axis;
  /** The grid line the edge is measured from. */
  ref: string;
  /** Signed distance of the edge from `ref` on the drawing. */
  design: number;
  actual?: number | null;
  /** Where the drawing disagrees with itself about this edge. */
  note?: string;
  at?: string | null;
}

/**
 * What gets taped on site (Niko, 15 Oct 2026): each column's size, and the clear gap
 * from the column before it along its row (gx, along a lettered-grid row) and along its
 * line (gy, down a lettered line). A gap is stored on the later column of the pair.
 * Positions follow from these: each column sits its gap past the one before it.
 */
export interface TapeMeasures {
  /** Width across the page (x), mm. */
  w?: number | null;
  /** Depth down the page (y), mm. */
  h?: number | null;
  /** Clear gap, face to face, from the previous column along the same row. */
  gx?: number | null;
  /** Clear gap, face to face, from the previous column down the same line. */
  gy?: number | null;
}

export interface ColumnEl extends TapeMeasures {
  _key: string;
  /** Type mark on the drawings: C1, C1a, SW4 ... */
  name: string;
  kind: "column" | "wall";
  x: string;
  y: string;
  design: Faces;
  actual?: Faces | null;
  /** Drawn hollow: the column stops at the slab above (does not continue). */
  ends?: boolean;
  at?: string | null;
  note?: string | null;
}

export interface CoreEl extends TapeMeasures {
  _key: string;
  name: string;
  x: string;
  y: string;
  design: CoreFaces;
  actual?: CoreFaces | null;
  door?: { side: "t" | "b" | "l" | "r"; from: number; width: number };
  at?: string | null;
  note?: string | null;
}

export type OpeningKind = "void" | "stair" | "pool" | "duct";

export interface OpeningEl {
  _key: string;
  kind: OpeningKind;
  name: string;
  x: string;
  y: string;
  /** Null for an opening that was only made on site (not on the drawings). */
  design: Faces | null;
  actual?: Faces | null;
  /** Created in the app (made on site). */
  added?: boolean | null;
  /** On the drawings but not made (or filled in). */
  removed?: boolean | null;
  at?: string | null;
  note?: string | null;
}

export interface LogEntry {
  _key: string;
  at: string;
  text: string;
  /** The element the change was about, for its own history. */
  el?: string;
  /** JSON list of { path, before, after } so a change can be undone. */
  changes?: string;
  /** Set on an undo: the entry it undid. */
  undoOf?: string;
}

export interface Floor {
  _id: string;
  _rev?: string;
  key: string;
  name: string;
  short: string;
  order: number;
  /** Structural slab level, mm. */
  level: number;
  source: string;
  notes: string[];
  grid: GridLine[];
  slab: { edges: SlabEdge[] } | null;
  columns: ColumnEl[];
  cores: CoreEl[];
  openings: OpeningEl[];
  log?: LogEntry[];
  seedVersion?: number;
}

export type BoxList = "columns" | "cores" | "openings";
export type BoxEl = ColumnEl | CoreEl | OpeningEl;

export type Selection =
  | { kind: "box"; list: BoxList; key: string }
  | { kind: "edge"; key: string }
  | { kind: "gap"; axis: Axis; to: string }
  /** The gap between two columns: `key` is the later one (it holds the gap). */
  | { kind: "colgap"; axis: Axis; list: "columns" | "cores"; key: string };

/** One stored change: a path into the floor document and its new value (null = remove). */
export interface Change {
  path: string;
  value: unknown;
}

export interface Tolerance {
  /** Up to this many mm off the drawing counts as fine. */
  ok: number;
  /** Up to this many mm is worth a look; beyond it is flagged. */
  warn: number;
}

export const DEFAULT_TOLERANCE: Tolerance = { ok: 10, warn: 25 };
