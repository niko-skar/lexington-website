// Deliveries (Niko, 5 Nov 2026: "stock that comes in from expenses and is ticked 'into the storeroom' then the
// storekeeper enters it, does that become a double entry?" ... "Yes arrived check for deliveries is good"). Stock is
// counted once, at the store door:
//   - what's expected (a paid purchase into the store room, or a purchase order placed for materials) is ticked
//     "Arrived" by whoever is at the store, or "Not all of it" with what came (the record then says what came);
//   - something that arrives unexpected is checked in as "Delivery arrived" and is stock at once; the expense that
//     pays for it later is tied to it ("Already in the store?"), so it doesn't add the stock again. An order's delivery
//     is tied to the order's payment by itself. A count that found more than the record can be tied the same way.
// Each check-in is a store move ("arrived"): its diff is what it changes the stock by (nothing when all that was paid
// for came; less when some didn't; all of it for a delivery nobody has paid for yet).

/** Paid purchases logged from now on are expected at the store (earlier ones are taken as arrived). */
export const DELIVERIES_FROM = "2026-11-05T14:00:00Z";
/** How long a paid purchase, and a placed order, wait to be ticked before they drop off the list. */
export const EXPECT_DAYS = 30;
export const ORDER_EXPECT_DAYS = 60;
/** How far back the expense form looks for a delivery (or a count) that could be the goods it pays for. */
export const MATCH_DAYS = 21;
export const MAX_DELIVERY_NOTE = 200;

/** Something to come in at the store. */
export interface ExpectedLine {
  /** "x:<expense id>:<item id>" or "o:<order id>:<line key>". */
  key: string;
  kind: "expense" | "order";
  /** The expense's or the order's id. */
  id: string;
  /** An order's line key. */
  line: string | null;
  /** The store item, when it's one already (an order's new thing becomes one when it arrives). */
  itemId: string | null;
  name: string;
  qty: number;
  unit: string;
  /** EXP-0123 or PO-0004. */
  ref: string | null;
  /** When it was paid, or ordered (YYYY-MM-DD). */
  date: string;
  /** An order's "needed by". */
  neededBy: string | null;
  /** The office only. */
  supplier?: string;
}

/**
 * Checked in but not paid for yet (the expense form offers them): a delivery, what a count found more than the record,
 * or a new item added with what was on the shelf (the old way a delivery went in: "added").
 */
export interface OpenArrival {
  moveId: string;
  itemId: string;
  qty: number;
  at: string;
  by: string;
  kind: "arrived" | "count" | "added";
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
/** "20 bags" */
export const qtyWords = (qty: number, unit: string) => `${fmt(qty)}${unit ? ` ${unit}` : ""}`;

/** What the expense form asks about a line: the arrivals of its item, the one of the same number first. */
export function arrivalsFor(itemId: string | null, qty: number, open: readonly OpenArrival[]): OpenArrival[] {
  if (!itemId) return [];
  const same = (a: OpenArrival) => Math.abs(a.qty - qty) < 0.001;
  return open.filter((a) => a.itemId === itemId).sort((a, b) => Number(same(b)) - Number(same(a)) || b.at.localeCompare(a.at));
}

/** The line's answer is a must when a delivery of exactly that many is waiting (it's almost surely that one). */
export const mustAsk = (itemId: string | null, qty: number, open: readonly OpenArrival[]) => arrivalsFor(itemId, qty, open).some((a) => Math.abs(a.qty - qty) < 0.001);
