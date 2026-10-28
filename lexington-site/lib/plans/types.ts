/**
 * Floor plans drawn on the as-built record (Niko, 28 Oct 2026: "a floor plan editor that can sit on
 * top of the as built measurements so I can make the apartments directly and find out the net
 * internal area quickly and make changes quickly").
 *
 * Every point is hung on something the as-built record knows: a grid line, a slab edge or a face of
 * a column (or wall, or lift core), plus a distance from it in mm. When the record changes (a line
 * comes out somewhere else, a column is taped off its line), the walls drawn against it move with it
 * and the areas follow.
 */

/**
 * What a coordinate is measured from, along one axis:
 * - a grid line id ("K", "7")
 * - "e:<edge key>": a slab edge
 * - "c:<columns|cores>:<key>:<l|r|t|b>": a face of a column, wall or lift core
 */
export interface Anchor {
  ref: string;
  /** mm from it (+ = right / down the page). */
  d: number;
}

export interface PlanPoint {
  x: Anchor;
  y: Anchor;
}

/**
 * External: the building's outside walls. Party: between two homes. Corridor: between a home and the
 * shared corridor or lobby. Partition: inside a home (it doesn't bound the net internal area).
 * Glazing: a window wall or sliding doors to a balcony. Balustrade: a balcony's edge.
 */
export type WallKind = "external" | "party" | "corridor" | "partition" | "glazing" | "balustrade";

export const WALL_KINDS: { kind: WallKind; label: string; t: number }[] = [
  { kind: "external", label: "External", t: 225 },
  { kind: "party", label: "Between homes", t: 225 },
  { kind: "corridor", label: "To the corridor", t: 225 },
  { kind: "partition", label: "Inside a home", t: 125 },
  { kind: "glazing", label: "Glazing", t: 100 },
  { kind: "balustrade", label: "Balcony edge", t: 100 },
];

/** Straight walls, along the grid (across or down the page), drawn on their centre line. */
export interface PlanWall {
  _key: string;
  a: PlanPoint;
  b: PlanPoint;
  kind: WallKind;
  /** Thickness, mm. */
  t: number;
}

export type OpeningKind = "door" | "double" | "slider" | "window";

/** A door or window in a wall. */
export interface PlanOpening {
  _key: string;
  wall: string;
  /** From the wall's first end (a) to the opening's middle, mm. */
  at: number;
  /** Clear width, mm. */
  w: number;
  kind: OpeningKind;
  /** Which way a door swings: to the other side of the wall. */
  flip?: boolean | null;
  /** Hinged at the other end. */
  hand?: boolean | null;
}

export type SpaceType =
  | "living"
  | "bedroom"
  | "kitchen"
  | "bath"
  | "wc"
  | "hall"
  | "store"
  | "laundry"
  | "balcony"
  | "terrace"
  | "corridor"
  | "lobby"
  | "stair"
  | "plant"
  | "other";

export const SPACE_TYPES: { type: SpaceType; label: string; common?: boolean; outdoor?: boolean }[] = [
  { type: "living", label: "Living" },
  { type: "bedroom", label: "Bedroom" },
  { type: "kitchen", label: "Kitchen" },
  { type: "bath", label: "Bathroom" },
  { type: "wc", label: "WC" },
  { type: "hall", label: "Hall" },
  { type: "store", label: "Store" },
  { type: "laundry", label: "Laundry" },
  { type: "balcony", label: "Balcony", outdoor: true },
  { type: "terrace", label: "Terrace", outdoor: true },
  { type: "corridor", label: "Corridor", common: true },
  { type: "lobby", label: "Lobby", common: true },
  { type: "stair", label: "Stair", common: true },
  { type: "plant", label: "Plant / duct", common: true },
  { type: "other", label: "Other" },
];

/** A room's name, kind and home, pinned to a point inside it. */
export interface SpaceLabel {
  _key: string;
  at: PlanPoint;
  name: string;
  type: SpaceType;
  /** The home it belongs to ("101A"), or null for a shared space. */
  unit?: string | null;
}

/** What a home's area is checked against (the contract's Stated NIA, else the website's area). */
export interface UnitTarget {
  _key: string;
  unit: string;
  stated: number;
}

/** One layout of one floor ("A", "B" ...). Stored in the private dataset, never on the public site. */
export interface PlanOption {
  _id: string;
  _rev?: string;
  _type?: "floorPlanOption";
  floorKey: string;
  /** Short key, unique on the floor: "a", "b". */
  option: string;
  name: string;
  walls: PlanWall[];
  openings: PlanOpening[];
  labels: SpaceLabel[];
  targets?: UnitTarget[] | null;
  updatedAt?: string;
  createdAt?: string;
}

/**
 * An architect's floor plan to trace over: a picture of the drawing, and where its grid lines are on
 * the page (PDF points from the top-left corner), so it can be laid on the as-built grid.
 */
export interface PlanReference {
  floorKey: string;
  title: string;
  url: string;
  /** The picture's size in pixels, and pixels per PDF point. */
  w: number;
  h: number;
  pxPerPt: number;
  xs: { line: string; pt: number }[];
  ys: { line: string; pt: number }[];
}

/** What a save sends: the drawing itself. */
export interface PlanContent {
  name: string;
  walls: PlanWall[];
  openings: PlanOpening[];
  labels: SpaceLabel[];
  targets: UnitTarget[];
}
