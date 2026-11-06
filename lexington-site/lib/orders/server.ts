import "server-only";
import { randomBytes } from "node:crypto";

import { listExpenses } from "@/lib/expenses/server";
import { FLOORS } from "@/lib/expenses/shared";
import { areasWith } from "@/lib/quickbooks/books";
import { cachedBookLists } from "@/lib/quickbooks/booksCache";
import { cachedVendors } from "@/lib/quickbooks/vendors";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BUY_PREFIX, isId, ITEM_PREFIX, newId, ORDER_COUNTER_ID, ORDER_PREFIX, TOOL_PREFIX } from "@/lib/site/ids";
import { getStore } from "@/lib/store/server";
import { ghanaDay } from "@/lib/store/shared";
import { toBuyLines } from "@/lib/store/shopping";
import { backFromOrder, gotByOrder } from "@/lib/store/shoppingServer";
import { listBills } from "@/lib/suppliers/server";
import { cleanText, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import {
  DONE_DAYS,
  MAX_ORDER_LINE,
  MAX_ORDER_LINES,
  MAX_ORDER_NOTE,
  MAX_ORDER_UNIT,
  ORDER_CATEGORIES,
  orderAmount,
  ordersFrom,
  type OrderLine,
  type OrdersPage,
  type OrderView,
  type PurchaseOrder,
  type ShopLine,
} from "./shared";

// Purchase orders (lib/orders/shared.ts says what and why): "purchaseOrder" documents ("po-live-*"), numbered PO-0001.
// They stay in the app: QuickBooks gets the bill or the payment an order becomes (lib/suppliers, lib/expenses).

type Data = Record<string, unknown>;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const GONE = "That order isn't there any more. Refresh the page.";

const ORDER_FIELDS = `{
  "id": _id,
  "number": coalesce(number, ""),
  "vendorId": vendorId,
  "supplier": coalesce(supplier, ""),
  "category": coalesce(category, "Material"),
  "lines": coalesce(lines[]{ "key": _key, "name": coalesce(name, ""), "qty": qty, "unit": coalesce(unit, ""), "price": price, "buyId": buyId, "itemId": itemId, "toolId": toolId }, []),
  "estimate": estimate,
  neededBy,
  "payBy": payBy,
  "note": coalesce(note, ""),
  "floor": floor,
  "costClass": costClass{ id, name },
  "status": coalesce(status, "planned"),
  "orderedAt": orderedAt,
  "orderedBy": orderedBy,
  "closedAt": closedAt,
  "closedBy": closedBy,
  createdAt,
  "createdBy": coalesce(createdBy, ""),
  "updatedAt": coalesce(updatedAt, createdAt)
}`;

type RawOrder = Omit<PurchaseOrder, "lines"> & { lines: Array<Omit<OrderLine, "qty" | "price" | "buyId" | "itemId" | "toolId"> & { qty?: number | null; price?: number | null; buyId?: string | null; itemId?: string | null; toolId?: string | null }> };
const toOrder = (raw: RawOrder): PurchaseOrder => ({
  ...raw,
  vendorId: raw.vendorId ?? null,
  estimate: typeof raw.estimate === "number" ? raw.estimate : null,
  payBy: raw.payBy ?? null,
  floor: raw.floor ?? null,
  costClass: raw.costClass ?? null,
  orderedAt: raw.orderedAt ?? null,
  orderedBy: raw.orderedBy ?? null,
  closedAt: raw.closedAt ?? null,
  closedBy: raw.closedBy ?? null,
  lines: raw.lines.map((l) => ({
    ...l,
    qty: typeof l.qty === "number" ? l.qty : null,
    price: typeof l.price === "number" ? l.price : null,
    buyId: l.buyId ?? null,
    itemId: l.itemId ?? null,
    toolId: l.toolId ?? null,
  })),
});

export async function listOrders(): Promise<PurchaseOrder[]> {
  const raw = await getBuyersClient().fetch<RawOrder[]>(`*[_type == "purchaseOrder" && string::startsWith(_id, $prefix)] | order(createdAt desc)[0...2000] ${ORDER_FIELDS}`, { prefix: ORDER_PREFIX });
  return raw.map(toOrder);
}

async function readOrder(id: string): Promise<PurchaseOrder | null> {
  const raw = await getBuyersClient().fetch<RawOrder | null>(`*[_id == $id && _type == "purchaseOrder"][0] ${ORDER_FIELDS}`, { id });
  return raw ? toOrder(raw) : null;
}

/** The orders with what has billed and paid them (today in Ghana); every one, done ones too. */
export async function orderViews(): Promise<OrderView[]> {
  const [orders, bills, expenses] = await Promise.all([listOrders(), listBills(), listExpenses()]);
  return ordersFrom(orders, bills, expenses, ghanaDay());
}

/** What's on the shopping list and on no order still open (the order form offers them). */
function shoppingLines(store: Awaited<ReturnType<typeof getStore>>, open: readonly PurchaseOrder[]): ShopLine[] {
  const taken = new Set(open.flatMap((o) => o.lines.flatMap((l) => [l.buyId, l.buyId ? null : l.itemId])).filter(Boolean));
  return toBuyLines(store.items, store.tools, store.buys)
    .map((line): ShopLine =>
      line.kind === "reorder"
        ? { key: line.key, name: line.item.name, qty: line.item.reorderQty ?? null, unit: line.item.unit, buyId: null, itemId: line.item.id, toolId: null, urgent: false }
        : {
            key: line.key,
            name: line.buy.name,
            qty: line.buy.qty,
            unit: line.buy.unit || line.item?.unit || "",
            buyId: line.buy.id,
            itemId: line.buy.itemId,
            toolId: line.buy.toolId,
            urgent: line.buy.urgent,
          }
    )
    .filter((l) => !taken.has(l.buyId ?? l.itemId));
}

/** The orders page: every order with where it stands, QuickBooks' suppliers, the shopping list, the floors and cost types. */
export async function ordersPage(me: TodoMe): Promise<OrdersPage> {
  const [orders, bills, expenses, vendors, books, store] = await Promise.all([
    listOrders(),
    listBills(),
    listExpenses(),
    cachedVendors(),
    cachedBookLists().catch(() => ({ classes: [], locations: [], fetchedAt: null })),
    getStore(me),
  ]);
  const today = ghanaDay();
  const views = ordersFrom(orders, bills, expenses, today);
  // Done ones stay a month after the last thing that happened to them (closed, changed, billed or paid).
  const since = addDays(today, -DONE_DAYS);
  const last = (o: OrderView) => [(o.closedAt ?? o.updatedAt).slice(0, 10), ...o.bills.map((b) => b.date), ...o.payments.map((p) => p.date)].sort().pop() ?? "";
  return {
    orders: views.filter((o) => !o.done || last(o) >= since),
    suppliers: vendors.vendors.map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name)),
    shopping: shoppingLines(store, orders.filter((o) => o.status === "planned" || o.status === "ordered")),
    areas: areasWith(FLOORS, books.locations),
    classes: books.classes,
    today,
  };
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/* ---------- an order ---------- */

function cleanDay(value: unknown, message: string): string {
  if (typeof value !== "string" || !DAY_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new TodoError(400, message);
  return value;
}
function cleanMoney(value: unknown, message: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(String(value).replace(/,/g, "")) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || n > 50_000_000) throw new TodoError(400, message);
  return n;
}
function cleanClass(value: unknown): { id: string; name: string } | null {
  if (value === null || value === undefined || value === "") return null;
  const v = value as { id?: unknown; name?: unknown };
  if (typeof v !== "object" || typeof v.id !== "string" || typeof v.name !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(v.id) || !v.name.trim() || v.name.length > 150) {
    throw new TodoError(400, "Pick the cost type again.");
  }
  return { id: v.id, name: v.name.trim() };
}
function cleanLines(value: unknown): Array<Omit<OrderLine, "key"> & { _key: string }> {
  if (!Array.isArray(value) || value.length === 0) throw new TodoError(400, "Add what's to be bought.");
  if (value.length > MAX_ORDER_LINES) throw new TodoError(400, `${MAX_ORDER_LINES} lines at most on one order.`);
  // Each line keeps its key (the phone's), unless two came with the same one.
  const keys = new Set<string>();
  const keyOf = (key: unknown) => {
    const k = typeof key === "string" && /^[a-zA-Z0-9-]{1,40}$/.test(key) && !keys.has(key) ? key : randomBytes(4).toString("hex");
    keys.add(k);
    return k;
  };
  return value.map((raw) => {
    const l = (raw ?? {}) as Data;
    const name = cleanText(l.name, MAX_ORDER_LINE, "item").replace(/\s+/g, " ");
    if (!name) throw new TodoError(400, "Say what each line is, or take the empty line off.");
    let qty: number | null = null;
    if (l.qty !== null && l.qty !== undefined && l.qty !== "") {
      qty = Math.round(Number(String(l.qty).replace(/,/g, "")) * 1000) / 1000;
      if (!(qty > 0 && qty <= 1_000_000)) throw new TodoError(400, `How many ${name}? Type a number, or leave it empty.`);
    }
    return {
      _key: keyOf(l.key),
      name,
      qty,
      unit: cleanText(l.unit, MAX_ORDER_UNIT, "unit"),
      price: cleanMoney(l.price, `Type the price of ${name} as a number, e.g. 9500.`),
      buyId: isId(BUY_PREFIX, l.buyId) ? l.buyId : null,
      itemId: isId(ITEM_PREFIX, l.itemId) ? l.itemId : null,
      toolId: isId(TOOL_PREFIX, l.toolId) ? l.toolId : null,
    };
  });
}

/** PO-0001, PO-0002...: the number the supplier quotes on their invoice. */
async function nextNumber(): Promise<string> {
  const client = getBuyersClient();
  await client.createIfNotExists({ _id: ORDER_COUNTER_ID, _type: "orderCounter", n: 0 });
  const doc = await client.patch(ORDER_COUNTER_ID).setIfMissing({ n: 0 }).inc({ n: 1 }).commit<{ n: number }>();
  return `PO-${String(doc.n).padStart(4, "0")}`;
}

/** An order made or changed: from whom (or not chosen yet), what, how many, the prices, by when. */
export async function saveOrder(me: TodoMe, body: Data): Promise<string> {
  let vendor: { id: string; name: string } | null = null;
  if (body.vendorId !== null && body.vendorId !== undefined && body.vendorId !== "") {
    vendor = (await cachedVendors()).vendors.find((v) => v.id === body.vendorId) ?? null;
    if (!vendor) throw new TodoError(400, "Pick the supplier again.");
  }
  const category = ORDER_CATEGORIES.find((c) => c === (body.category ?? "Material"));
  if (!category) throw new TodoError(400, "Pick Material, Service or Other.");
  const lines = cleanLines(body.lines);
  const estimate = cleanMoney(body.estimate, "Type about how much it all comes to, e.g. 18000.");
  const amount = orderAmount({ lines: lines.map((l) => ({ ...l, key: l._key })), estimate });
  if (!(amount > 0)) throw new TodoError(400, "Put a price on the lines, or say about how much it all comes to (the cash flow needs it).");
  const neededBy = cleanDay(body.neededBy, "Pick when it's needed.");
  // When it's paid (null, or the day it comes: when it comes).
  const payBy = body.payBy ? cleanDay(body.payBy, "Pick when it's to be paid.") : null;
  const note = cleanText(body.note, MAX_ORDER_NOTE, "note");
  const areas = areasWith(FLOORS, (await cachedBookLists().catch(() => ({ locations: [] }))).locations);
  const floor = body.floor ? (typeof body.floor === "string" && areas.includes(body.floor) ? body.floor : null) : null;
  if (body.floor && !floor) throw new TodoError(400, "Pick the floor or stage again.");
  const costClass = cleanClass(body.costClass);
  const client = getBuyersClient();
  const now = new Date().toISOString();
  const fields = {
    vendorId: vendor?.id ?? null,
    supplier: vendor?.name ?? "",
    category,
    lines,
    // The estimate only counts without prices; kept as typed.
    estimate,
    neededBy,
    payBy: payBy && payBy !== neededBy ? payBy : null,
    note,
    floor,
    costClass,
    updatedAt: now,
    updatedBy: me.name,
  };

  if (body.id !== undefined) {
    if (!isId(ORDER_PREFIX, body.id)) throw new TodoError(404, GONE);
    const before = await readOrder(body.id);
    if (!before) throw new TodoError(404, GONE);
    if (before.status === "closed" || before.status === "cancelled") throw new TodoError(409, "This order is closed. Open it again first, then change it.");
    await client.patch(body.id).set(fields).commit();
    // Ordered already: lines added from the shopping list are bought with it.
    if (before.status === "ordered") await gotByOrder(me, before.number, lines.filter((l) => !before.lines.some((b) => (b.buyId ?? b.itemId) === (l.buyId ?? l.itemId))));
    return body.id;
  }
  const id = newId(ORDER_PREFIX);
  await client.create({ _id: id, _type: "purchaseOrder", number: await nextNumber(), ...fields, status: "planned", createdAt: now, createdBy: me.name });
  return id;
}

/**
 *   { action: "ordered" }    placed with the supplier (it needs one): its shopping list lines are bought
 *   { action: "unordered" }  back to "to order" (nothing billed or paid yet): its shopping list lines to buy again
 *   { action: "close" }      the rest isn't needed (some of it billed or paid): off the cash flow
 *   { action: "cancel" }     not wanted after all (nothing billed or paid): its shopping list lines to buy again
 *   { action: "reopen" }     a closed or cancelled one back as it was
 */
export async function moveOrder(me: TodoMe, body: Data): Promise<void> {
  if (!isId(ORDER_PREFIX, body.id)) throw new TodoError(404, GONE);
  const id = body.id;
  const [view] = ordersFrom([(await readOrder(id)) ?? missing()], await listBills(), await listExpenses(), ghanaDay());
  const used = view.billed > 0 || view.paid > 0;
  const client = getBuyersClient();
  const now = new Date().toISOString();
  if (body.action === "ordered") {
    if (view.status !== "planned") throw new TodoError(409, "It's ordered already.");
    if (!view.vendorId) throw new TodoError(400, "Pick the supplier first: who is it ordered from?");
    await client.patch(id).set({ status: "ordered", orderedAt: now, orderedBy: me.name, updatedAt: now }).commit();
    await gotByOrder(me, view.number, view.lines);
  } else if (body.action === "unordered") {
    if (view.status !== "ordered") throw new TodoError(409, "It isn't ordered.");
    if (used) throw new TodoError(409, "It has a bill or a payment already, so it stays ordered.");
    await client.patch(id).set({ status: "planned", updatedAt: now }).unset(["orderedAt", "orderedBy"]).commit();
    await backFromOrder(view.number);
  } else if (body.action === "close") {
    if (view.status !== "planned" && view.status !== "ordered") throw new TodoError(409, "It's closed already.");
    await client.patch(id).set({ status: "closed", closedAt: now, closedBy: me.name, updatedAt: now }).commit();
  } else if (body.action === "cancel") {
    if (view.status !== "planned" && view.status !== "ordered") throw new TodoError(409, "It's closed already.");
    if (used) throw new TodoError(409, "It has a bill or a payment already: close it instead (the rest isn't needed).");
    await client.patch(id).set({ status: "cancelled", closedAt: now, closedBy: me.name, updatedAt: now }).commit();
    await backFromOrder(view.number);
  } else if (body.action === "reopen") {
    if (view.status !== "closed" && view.status !== "cancelled") throw new TodoError(409, "It's open already.");
    const status = view.orderedAt ? "ordered" : "planned";
    await client.patch(id).set({ status, updatedAt: now }).unset(["closedAt", "closedBy"]).commit();
    if (status === "ordered" && view.status === "cancelled") await gotByOrder(me, view.number, view.lines);
  } else {
    throw new TodoError(400, "That button isn't known.");
  }
}

function missing(): never {
  throw new TodoError(404, GONE);
}
