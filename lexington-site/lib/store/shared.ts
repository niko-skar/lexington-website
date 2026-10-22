// The store room (/todo/store). Niko, 22 Oct 2026: stock goes up "when i pay" (the Material
// purchase he logs in the expenses), "albert and I can record materials going out", "and shortly
// we'll have a dedicated store room keeper". Counts show any gap between the record and the shelf.
// Site logins see quantities only: never a price or a supplier.

export const MAX_ITEM_NAME = 60;
export const MAX_UNIT = 20;
export const MAX_PERSON = 60;
export const MAX_MOVE_NOTE = 200;

/** Units offered as buttons (anything else can be typed). */
export const UNITS = ["pcs", "bags", "sheets", "lengths", "rolls", "boxes", "tons", "kg", "m", "litres"] as const;

export interface StoreItem {
  id: string;
  name: string;
  unit: string;
  /** False: bought for use straight away (ready-mix, sand...), never kept in the store. */
  stocked: boolean;
  /** Warn when the stock falls to this (the office sets it). */
  low: number | null;
  /** In the store now, by the record: bought + added + brought back - taken out +/- counts. */
  level: number;
  lastCountAt: string | null;
}

/** What moved, newest first. "bought" comes from a paid Material expense (the office sees the price). */
export type MoveKind = "out" | "back" | "in" | "count";
export interface StoreEntry {
  id: string;
  kind: MoveKind | "bought";
  itemId: string;
  /** For a count: the number counted. */
  qty: number;
  /** A count only: counted minus the record (negative = missing). */
  diff: number | null;
  /** The first count of a new item (its starting stock). */
  opening?: boolean;
  floor: string | null;
  /** Who took it out / brought it back. */
  person: string | null;
  note: string;
  at: string;
  by: string;
  /** Recorded by whoever is looking (a site login can undo its own for a few minutes). */
  mine: boolean;
  /** "bought" only, for the office. */
  supplier?: string;
  amount?: number;
  date?: string;
}

export const fmtQty = (n: number) => (Number(n) || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });

const ONE: Record<string, string> = {
  bags: "bag",
  sheets: "sheet",
  lengths: "length",
  rolls: "roll",
  boxes: "box",
  tons: "ton",
  litres: "litre",
  pcs: "pc",
  pieces: "piece",
  trips: "trip",
  bundles: "bundle",
  tins: "tin",
};
/** "1 bag", "40 bags". */
export const qtyUnit = (n: number, unit: string) => `${fmtQty(n)} ${Math.abs(n) === 1 ? ONE[unit] ?? unit : unit}`;

/** Items people can undo for a short while after recording (a wrong tap). */
export const UNDO_MINUTES = 15;
