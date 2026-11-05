import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { isId, ORDER_PREFIX } from "@/lib/site/ids";
import { gotByOrder } from "@/lib/store/shoppingServer";
import { TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";

// A bill or an expense made from a purchase order (lib/orders/shared.ts): which order, checked, and what making one
// does to it. Kept apart from lib/orders/server.ts, which reads the bills and the expenses itself.

const GONE = "That order isn't there any more: open it again.";

/** The order a new bill or expense is made from: one still open (to order, or ordered), or none. */
export async function cleanOrderLink(value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  if (!isId(ORDER_PREFIX, value)) throw new TodoError(404, GONE);
  const status = await getBuyersClient().fetch<string | null>(`*[_id == $id && _type == "purchaseOrder"][0].status`, { id: value });
  if (!status) throw new TodoError(404, GONE);
  if (status === "cancelled") throw new TodoError(409, "That order was cancelled. Open it again first (on the order).");
  if (status === "closed") throw new TodoError(409, "That order is closed. Open it again first (on the order).");
  return value;
}

/**
 * A bill or an expense was made from the order: an order still to place is ordered now (bought on credit, or paid),
 * and what it had from the shopping list is bought.
 */
export async function orderUsed(me: TodoMe, poId: string): Promise<void> {
  const client = getBuyersClient();
  const o = await client.fetch<{ number: string; status: string; _rev: string; lines: Array<{ buyId?: string | null; itemId?: string | null }> | null } | null>(
    `*[_id == $id && _type == "purchaseOrder"][0]{ number, status, _rev, lines[]{ buyId, itemId } }`,
    { id: poId }
  );
  if (!o || o.status !== "planned") return;
  try {
    await client.patch(poId).ifRevisionId(o._rev).set({ status: "ordered", orderedAt: new Date().toISOString(), orderedBy: me.name, updatedAt: new Date().toISOString() }).commit();
  } catch {
    return; // changed meanwhile (marked ordered by hand, most likely): that did the rest
  }
  await gotByOrder(me, o.number, (o.lines ?? []).map((l) => ({ buyId: l.buyId ?? null, itemId: l.itemId ?? null })));
}
