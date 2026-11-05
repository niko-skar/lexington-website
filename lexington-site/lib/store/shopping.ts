// The shopping list (Niko, 5 Nov 2026: "Make me the reorder list where I can also add things not in the store room so
// it becomes a shopping list for me that Albert or the storekeeper can add to, so whenever I'm at the hardware store I
// can see what's required"). Two kinds of line: a store item down to its reorder point (the old reorder list), and
// anything someone added (more of an item or a tool, or something the store doesn't keep). Ticked at the shop, a line
// moves to "Got"; a store item's stock still goes up only when its payment is logged into the store.
// Pure: used on the server and the phone alike.

import { categoryOf, guessCategory, STORE_CATEGORIES } from "./categories";
import { nameScore } from "./doubles";
import { fmtQty, needsReorder, qtyUnit, type StoreItem, type StoreTool } from "./shared";

export const MAX_BUY_NAME = 60;
export const MAX_BUY_NOTE = 200;
export const MAX_BUY_UNIT = 20;
/** What was got stays on the list this long (the server sends no older). */
export const GOT_DAYS = 14;

/** The list's headings at the shop: the store room's categories, with tools on their own. */
export const BUY_GROUPS = [...STORE_CATEGORIES.filter((c) => c !== "Other"), "Tools", "Other"] as const;
export type BuyGroup = (typeof BUY_GROUPS)[number];
export const isBuyGroup = (value: unknown): value is BuyGroup => typeof value === "string" && (BUY_GROUPS as readonly string[]).includes(value);

// Names the store's categories don't place that are tools (the store's own tools are on the tool list).
const TOOL_NAMES =
  /hammer|shovel|spade|wheel ?barrow|head ?pans?|trowel|\bfloats?\b|spirit level|\blevels?\b|\bsaws?\b|grinder|\bdrills?\b|ladder|pick ?axe|mattock|crow ?bar|pinch bar|chisel|\bplanes?\b|measuring tape|tape measure|plumb ?bob|\bsquares?\b|\bclamps?\b|pliers|pincers|spanner|wrench|screw ?driver|bolt cutter|rammer|compactor|rake|cutlass|machete|\bbuckets?\b|\bsieves?\b/i;

/** The heading a name goes under: the store's category for it, else Tools when it's a tool, else Other. */
export function guessBuyGroup(name: string): BuyGroup {
  const category = guessCategory(name);
  return category === "Other" && TOOL_NAMES.test(name) ? "Tools" : category;
}

/** One thing on the list that someone added (lib/store/shoppingServer.ts). */
export interface StoreBuy {
  id: string;
  name: string;
  /** How many, or null when it wasn't said. */
  qty: number | null;
  /** "" when it wasn't said. */
  unit: string;
  note: string;
  photoUrl: string | null;
  category: BuyGroup;
  /** More of a store item, or of a tool: what's there shows with it. */
  itemId: string | null;
  toolId: string | null;
  /** Needed today: the office's phone buzzed when a site login added it. */
  urgent: boolean;
  at: string;
  by: string;
  /** Added from this login: it can change it or take it off while it's still to buy. */
  mine: boolean;
  /** Bought: when, and by whom; null while it's still to buy. */
  gotAt: string | null;
  gotBy: string | null;
}

/** A line to buy: a store item at its reorder point, or something added (with the item or tool it's more of). */
export type BuyLine =
  | { kind: "reorder"; key: string; item: StoreItem }
  | { kind: "buy"; key: string; buy: StoreBuy; item: StoreItem | null; tool: StoreTool | null };

/** A line got lately: something added and ticked, or a store item ticked at its reorder point. */
export type GotLine =
  | { kind: "reorder"; key: string; item: StoreItem; at: string; by: string }
  | { kind: "buy"; key: string; buy: StoreBuy; item: StoreItem | null; tool: StoreTool | null; at: string; by: string };

export const lineName = (line: BuyLine | GotLine) => (line.kind === "reorder" ? line.item.name : line.buy.name);
export const lineGroup = (line: BuyLine | GotLine): BuyGroup => (line.kind === "reorder" ? categoryOf(line.item) : line.buy.category);
const lineUrgent = (line: BuyLine) => line.kind === "buy" && line.buy.urgent;
/** None of it left in the store (a store item's line). */
const lineOut = (line: BuyLine) => !!line.item && line.item.stocked && line.item.level <= 0;

/** What's to buy: everything added and not got, and the store items at their reorder point that nobody added. */
export function toBuyLines(items: readonly StoreItem[], tools: readonly StoreTool[], buys: readonly StoreBuy[]): BuyLine[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const toolById = new Map(tools.map((t) => [t.id, t]));
  const open = buys.filter((b) => !b.gotAt);
  const added = new Set(open.map((b) => b.itemId).filter(Boolean));
  const lines: BuyLine[] = [
    ...open.map((b) => ({ kind: "buy" as const, key: b.id, buy: b, item: b.itemId ? (itemById.get(b.itemId) ?? null) : null, tool: b.toolId ? (toolById.get(b.toolId) ?? null) : null })),
    ...items.filter((i) => needsReorder(i) && !added.has(i.id)).map((i) => ({ kind: "reorder" as const, key: i.id, item: i })),
  ];
  // Needed today first, then what's run out, then by name.
  return lines.sort(
    (a, b) =>
      Number(lineUrgent(b)) - Number(lineUrgent(a)) ||
      Number(lineOut(b)) - Number(lineOut(a)) ||
      lineName(a).localeCompare(lineName(b), "en", { sensitivity: "base" })
  );
}

/** How many lines are to buy (the badge on the bar, the home page's tile). */
export const toBuyCount = (items: readonly StoreItem[], buys: readonly StoreBuy[]) => toBuyLines(items, [], buys).length;

/** What was got lately, newest first: added things ticked, and store items ticked at their reorder point. */
export function gotLines(items: readonly StoreItem[], tools: readonly StoreTool[], buys: readonly StoreBuy[]): GotLine[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const toolById = new Map(tools.map((t) => [t.id, t]));
  const got = buys.filter((b) => b.gotAt);
  // A store item ticked through something added for it shows once (as that).
  const through = new Set(got.map((b) => b.itemId).filter(Boolean));
  const lines: GotLine[] = [
    ...got.map((b) => ({
      kind: "buy" as const,
      key: b.id,
      buy: b,
      item: b.itemId ? (itemById.get(b.itemId) ?? null) : null,
      tool: b.toolId ? (toolById.get(b.toolId) ?? null) : null,
      at: b.gotAt!,
      by: b.gotBy ?? "",
    })),
    ...items
      .filter((i) => i.reorderGot && !through.has(i.id))
      .map((i) => ({ kind: "reorder" as const, key: i.id, item: i, at: i.reorderGot!.at, by: i.reorderGot!.by })),
  ];
  return lines.sort((a, b) => b.at.localeCompare(a.at));
}

/** The lines under their headings, in the headings' order (empty ones left out). */
export function byGroup<T extends BuyLine | GotLine>(lines: readonly T[]): Array<readonly [BuyGroup, T[]]> {
  return BUY_GROUPS.map((g) => [g, lines.filter((l) => lineGroup(l) === g)] as const).filter(([, l]) => l.length > 0);
}

/** "20 bags", "3" (no unit said), or "" (no number said). */
export const buyQty = (qty: number | null, unit: string) => (qty === null ? "" : unit ? qtyUnit(qty, unit) : fmtQty(qty));

/** How much to get: what was asked, else a store item's reorder quantity; "" when nobody said. */
export function lineQty(line: BuyLine | GotLine): string {
  if (line.kind === "reorder") return line.item.reorderQty ? qtyUnit(line.item.reorderQty, line.item.unit) : "";
  return buyQty(line.buy.qty, line.buy.unit);
}

/** What the store has of it now, for a line that's a store item ("3 bags left", "None left"); "" otherwise. */
export function lineStock(line: BuyLine | GotLine): string {
  const item = line.item;
  if (!item || !item.stocked) return "";
  return item.level <= 0 ? "None left" : `${qtyUnit(item.level, item.unit)} left`;
}

/** The list to paste in WhatsApp (to a supplier, or someone going to the shop). */
export function buyListText(lines: readonly BuyLine[], when: Date = new Date()): string {
  return [
    `Lexington site: to buy (${when.toLocaleDateString("en-GB", { day: "numeric", month: "short" })})`,
    ...byGroup(lines).flatMap(([group, list]) => [
      "",
      `*${group}*`,
      ...list.map((line) => {
        const qty = lineQty(line);
        const stock = lineStock(line);
        const note = line.kind === "buy" && line.buy.note ? ` – ${line.buy.note}` : "";
        const today = line.kind === "buy" && line.buy.urgent ? " (needed today)" : "";
        return `• ${lineName(line)}: ${qty || "how many?"}${stock ? ` (${stock.toLowerCase()})` : ""}${note}${today}`;
      }),
    ]),
  ].join("\n");
}

/**
 * Store items and tools a name being typed could be (to add more of one): the likeliest few, best first. A few letters
 * typed find names that start that way or have that word.
 */
export function storeMatches(name: string, items: readonly StoreItem[], tools: readonly StoreTool[], max = 3): Array<{ kind: "item"; item: StoreItem } | { kind: "tool"; tool: StoreTool }> {
  const typed = name.trim().toLowerCase();
  if (typed.length < 3) return [];
  const score = (n: string) => {
    const lower = n.toLowerCase();
    const words = lower.split(/[^a-z0-9]+/);
    const start = lower.startsWith(typed) || words.some((w) => w.length >= 3 && w.startsWith(typed)) ? 0.8 : lower.includes(typed) ? 0.6 : 0;
    return Math.max(start, nameScore(name, n));
  };
  const scored: Array<{ s: number; match: { kind: "item"; item: StoreItem } | { kind: "tool"; tool: StoreTool } }> = [
    ...items.filter((i) => i.stocked).map((item) => ({ s: score(item.name), match: { kind: "item" as const, item } })),
    ...tools.filter((t) => !t.retired).map((tool) => ({ s: score(tool.name), match: { kind: "tool" as const, tool } })),
  ];
  return scored
    .filter((m) => m.s >= 0.6)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((m) => m.match);
}

/** A line to buy already for the same thing (the same item or tool, or a name like it), or null. */
export function onListAlready(name: string, itemId: string | null, toolId: string | null, lines: readonly BuyLine[]): BuyLine | null {
  if (itemId) {
    const same = lines.find((l) => l.item?.id === itemId);
    if (same) return same;
  }
  if (toolId) {
    const same = lines.find((l) => l.kind === "buy" && l.buy.toolId === toolId);
    if (same) return same;
  }
  if (name.trim().length < 3) return null;
  let best: BuyLine | null = null;
  let top = 0;
  for (const line of lines) {
    const s = nameScore(name, lineName(line));
    if (s >= 0.7 && s > top) {
      best = line;
      top = s;
    }
  }
  return best;
}
