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

/* ---------- who uses it, and the state a tool is in (Niko, 3 Nov 2026) ---------- */
// "Tool department carpenter, mason, or Steelbender ... Same for materials", and "Add tool condition buttons".

/** The trade a tool or material is for; "all" when everyone uses it (a ladder, cutting discs). */
export const TRADES = ["carpentry", "masonry", "steel", "all"] as const;
export type Trade = (typeof TRADES)[number];
export const TRADE_NAMES: Record<Trade, string> = { carpentry: "Carpenters", masonry: "Masons", steel: "Steel benders", all: "Everyone" };
export const isTrade = (value: unknown): value is Trade => typeof value === "string" && (TRADES as readonly string[]).includes(value);

export const CONDITIONS = ["new", "good", "worn", "repair", "broken"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_NAMES: Record<Condition, string> = { new: "New", good: "Good", worn: "Worn", repair: "Needs repair", broken: "Broken" };
export const isCondition = (value: unknown): value is Condition => typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
/** Something has to be done about it (repaired or replaced). */
export const needsFixing = (c: Condition | null | undefined) => c === "repair" || c === "broken";
const WORSE: Record<Condition, number> = { new: 0, good: 1, worn: 2, repair: 3, broken: 4 };
/**
 * A tool's condition after it comes back reported as `back`: only ever worse (a used new one is good); a repair or a
 * breakage stays until someone sets it right on the tool.
 */
export const conditionAfter = (now: Condition | null, back: Condition): Condition => {
  const was = now === "new" || now === null ? "good" : now;
  return WORSE[back] > WORSE[was] ? back : was;
};

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
  /** Its category (lib/store/categories.ts), or null: then it goes by its name. */
  category: string | null;
  /** Who uses it, or null: then it goes by its name and category (tradeOfItem). */
  trade: Trade | null;
  /** Added by a site login and not checked by the office yet (only the office sees it). */
  review?: StoreReview | null;
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

/** The day in Ghana (GMT all year round), e.g. "2026-10-23": what "today" means for the store room. */
export const ghanaDay = (at: string | number | Date = Date.now()) => new Date(at).toISOString().slice(0, 10);

/* ---------- tools ---------- */
// Niko, 23 Oct 2026: "a section for tools with daily take outs and returns". Unlike materials,
// tools come back: each take-out stays open, with who has it, until it's all back (or the office
// marks it lost). Tools are counted in whole numbers.

export const MAX_TOOL_NAME = 60;
export const MAX_TOOL_COUNT = 1000;

export interface StoreTool {
  id: string;
  name: string;
  /** How many we have. The office keeps it right; marking one lost takes it off. */
  count: number;
  /** Not used any more: off the list (what happened to it stays on record). */
  retired: boolean;
  photoUrl: string | null;
  /** Who uses it, or null: then it goes by its name (tradeOfTool). */
  trade: Trade | null;
  /** The state it's in, as last said (when added, when it came back, or set on the tool); null: not said yet. */
  condition: Condition | null;
  /** Added by a site login and not checked by the office yet (only the office sees it). */
  review?: StoreReview | null;
}

/** Who added it, and when, for the office's "To check". */
export interface StoreReview {
  by: string;
  at: string;
}

export interface ToolReturn {
  key: string;
  qty: number;
  /** The office marked it lost: it never came back. */
  lost: boolean;
  /** The state it came back in (since 3 Nov 2026). */
  condition: Condition | null;
  note: string;
  photoUrl: string | null;
  at: string;
  by: string;
  mine: boolean;
}

/** One tool taken out by one person (tools taken together share the photo). */
export interface ToolOut {
  id: string;
  toolId: string;
  qty: number;
  person: string;
  note: string;
  photoUrl: string | null;
  at: string;
  by: string;
  mine: boolean;
  /** What came back so far, oldest first. */
  returns: ToolReturn[];
  /** When the last of it came back (or was marked lost); null while any is still out. */
  closedAt: string | null;
}

/** How many of a take-out are still out. */
export const stillOut = (out: ToolOut) => Math.max(0, out.qty - out.returns.reduce((n, r) => n + r.qty, 0));
export const toolWord = (n: number) => (Math.abs(n) === 1 ? "tool" : "tools");

/* ---------- tools to fix (Niko, 3 Nov 2026) ---------- */
// "make a place for broken tools or needs repair to show so i know at any one time what needs to be sent out to be
// fixed". Each breakage is its own record with how many (one broken shovel of ten says one): made when a tool comes
// back broken or needing repair, or when it's said on the tool; then sent out to be fixed, and back fixed (or, the
// office, written off).

export type RepairState = "waiting" | "away" | "fixed" | "scrapped";
export const MAX_REPAIRER = 60;

export interface ToolRepair {
  id: string;
  toolId: string;
  qty: number;
  condition: "repair" | "broken";
  /** What's wrong: the note it came back with, or what was typed when it was reported. */
  note: string;
  photoUrl: string | null;
  /** Who had it when it came back that way, or null (said on the tool). */
  person: string | null;
  /** Reported: when, by whom. */
  at: string;
  by: string;
  state: RepairState;
  /** Sent out to be fixed: when, to whom (a fundi, a shop), by whom. */
  sentAt: string | null;
  sentTo: string;
  sentBy: string | null;
  /** Back fixed, or written off: when, by whom. */
  closedAt: string | null;
  closedBy: string | null;
  /** Reported from this login: it can take it off for a few minutes (a mistake). */
  mine: boolean;
}

/** Still to be dealt with: waiting to go out, or at the repairer. */
export const isOpenRepair = (r: Pick<ToolRepair, "state">) => r.state === "waiting" || r.state === "away";

/** Per tool: how many wait to go out to be fixed, and how many are at the repairer. */
export function repairsByTool(repairs: readonly ToolRepair[]): Map<string, { waiting: number; away: number; worst: "repair" | "broken" }> {
  const map = new Map<string, { waiting: number; away: number; worst: "repair" | "broken" }>();
  for (const r of repairs) {
    if (!isOpenRepair(r)) continue;
    const now = map.get(r.toolId) ?? { waiting: 0, away: 0, worst: "repair" as const };
    if (r.state === "waiting") now.waiting += r.qty;
    else now.away += r.qty;
    if (r.condition === "broken") now.worst = "broken";
    map.set(r.toolId, now);
  }
  return map;
}

/* ---------- opening and closing the store room ---------- */
// Niko, 23 Oct 2026: "daily pictures of opening store room and closing store room". Taken there and
// then with the camera; closing also notes how many tools were still out.

export const MAX_CHECK_PHOTOS = 6;
export type CheckKind = "open" | "close";

export interface StoreCheck {
  id: string;
  kind: CheckKind;
  photoUrls: string[];
  note: string;
  /** Closing only: tools still out at that moment. */
  toolsOut: number | null;
  at: string;
  by: string;
  mine: boolean;
}

/** The whole store room as the page gets it. */
export type StoreData = { items: StoreItem[]; history: StoreEntry[]; tools: StoreTool[]; toolOuts: ToolOut[]; repairs: ToolRepair[]; checks: StoreCheck[] };
