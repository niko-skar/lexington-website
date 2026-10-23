// The store room (/todo/store). Niko, 22 Oct 2026: stock goes up "when i pay" (the Material
// purchase he logs in the expenses), "albert and I can record materials going out", "and shortly
// we'll have a dedicated store room keeper". Counts show any gap between the record and the shelf.
// Site logins see quantities only: never a price or a supplier.
// 23 Oct 2026: photos of the stock (required for anything going out), reorder points with an
// optional reorder quantity, and a reorder list the office can dismiss items from.

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
  /** Reorder point: reorder when the stock is down to this (the office sets it). */
  low: number | null;
  /** How much to order when it's time (optional). */
  reorderQty: number | null;
  /** The office said no need to reorder this time; cleared by itself once it's restocked. */
  reorderDismissed: boolean;
  /** A photo of the stock as it is (anyone using the store can add one). */
  photoUrl: string | null;
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
  /** The photo taken with it (always one for stock going out). */
  photoUrl?: string | null;
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

/** Down to its reorder point (and still kept in the store). */
export const atReorderPoint = (item: StoreItem) => item.stocked && item.low !== null && item.level <= item.low;
/** On the reorder list: at its reorder point and not dismissed by the office. */
export const needsReorder = (item: StoreItem) => atReorderPoint(item) && !item.reorderDismissed;

/** Items people can undo for a short while after recording (a wrong tap). */
export const UNDO_MINUTES = 15;
