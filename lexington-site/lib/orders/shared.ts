import type { Expense } from "@/lib/expenses/shared";
import type { Bill } from "@/lib/suppliers/shared";

// Purchase orders (Niko, 5 Nov 2026: "purchase orders i should be able to make that can then convert into bills or
// expenses as of and when the goods are ordered and / or paid", with the cash flow's "what needs to be bought and
// when"). An order is what's to be bought, from whom, for how much and by when. It stays in the app: QuickBooks gets
// nothing until it becomes a supplier's bill (bought on credit, paid later) or an expense (paid there and then), all at
// once or in parts. What's left of it is still to buy, and the cash flow counts that on the day it's needed.

export const ORDER_CATEGORIES = ["Material", "Service", "Other"] as const;
export type OrderCategory = (typeof ORDER_CATEGORIES)[number];
export const MAX_ORDER_LINES = 30;
export const MAX_ORDER_LINE = 80;
export const MAX_ORDER_UNIT = 20;
export const MAX_ORDER_NOTE = 300;
/** Done orders stay on the list this long. */
export const DONE_DAYS = 30;

export interface OrderLine {
  key: string;
  name: string;
  qty: number | null;
  unit: string;
  /** Each, in GH₵ (null: no price yet). */
  price: number | null;
  /** From the shopping list: the line it was (lib/store/shopping.ts), or the store item at its reorder point. */
  buyId: string | null;
  itemId: string | null;
  toolId: string | null;
}

/** To order (planned), ordered (the supplier has it), closed by hand (the rest isn't needed), or cancelled. */
export type OrderStatus = "planned" | "ordered" | "closed" | "cancelled";

export interface PurchaseOrder {
  id: string;
  /** PO-0001 */
  number: string;
  /** The QuickBooks supplier, once chosen (an order can be planned before). */
  vendorId: string | null;
  supplier: string;
  category: OrderCategory;
  lines: OrderLine[];
  /** About how much, when no line has a price. */
  estimate: number | null;
  /** YYYY-MM-DD: when it's needed (the goods at the site). */
  neededBy: string;
  /** YYYY-MM-DD: when it's to be paid (ordered now, paid at the end of the month), or null: when it comes. The cash flow counts it then. */
  payBy: string | null;
  note: string;
  /** Carried over to the bill or the expense it becomes. */
  floor: string | null;
  costClass: { id: string; name: string } | null;
  status: OrderStatus;
  orderedAt: string | null;
  orderedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/** An order with what has become of it. */
export interface OrderView extends PurchaseOrder {
  amount: number;
  billed: number;
  paid: number;
  /** Still to buy: what the cash flow counts. */
  left: number;
  bills: Array<{ id: string; appRef: string | null; amount: number; date: string }>;
  payments: Array<{ id: string; ref: string | null; amount: number; date: string; method: string | null }>;
  /** Its day has gone and something is still to buy. */
  late: boolean;
  /** Billed or paid in full, closed by hand, or cancelled: off the open list. */
  done: boolean;
  /** Lines without a price (counted as nothing). */
  unpriced: number;
}

/** Something on the shopping list on no order yet: offered on the order form, to add as a line. */
export interface ShopLine {
  key: string;
  name: string;
  qty: number | null;
  unit: string;
  buyId: string | null;
  itemId: string | null;
  toolId: string | null;
  urgent: boolean;
}

/** The orders page: the orders, and what the order form offers. */
export interface OrdersPage {
  orders: OrderView[];
  /** QuickBooks' suppliers (the order's supplier is one of them, so its bill matches). */
  suppliers: Array<{ id: string; name: string }>;
  shopping: ShopLine[];
  areas: string[];
  classes: Array<{ id: string; name: string }>;
  today: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** A line's money: how many times each (one, when no number's said); nothing without a price. */
export const lineTotal = (l: Pick<OrderLine, "qty" | "price">) => (l.price === null ? 0 : round((l.qty ?? 1) * l.price));

/** What the order comes to: its priced lines, or the estimate when no line has a price. */
export function orderAmount(o: Pick<PurchaseOrder, "lines" | "estimate">): number {
  const priced = o.lines.filter((l) => l.price !== null);
  return priced.length ? round(priced.reduce((n, l) => n + lineTotal(l), 0)) : round(o.estimate ?? 0);
}

/** "3 tons", "20 bags", "3", or "" when no number's said. */
export const qtyWords = (l: Pick<OrderLine, "qty" | "unit">) =>
  l.qty === null ? "" : `${Number.isInteger(l.qty) ? l.qty : Math.round(l.qty * 1000) / 1000}${l.unit ? ` ${l.unit}` : ""}`;

/** "16mm steel x 3 tons; 12mm steel x 2 tons" (what the bill or the expense says it was). */
export function linesText(lines: readonly Pick<OrderLine, "name" | "qty" | "unit">[]): string {
  return lines.map((l) => (qtyWords(l) ? `${l.name} x ${qtyWords(l)}` : l.name)).join("; ");
}

/** What a bill or an expense made from the order says: "PO-0004: 16mm steel x 3 tons; ...", cut to fit. */
export function orderDescription(o: Pick<PurchaseOrder, "number" | "lines" | "note">, max: number): string {
  const text = `${o.number}: ${linesText(o.lines) || o.note || "purchase order"}`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The orders with what has billed and paid them (the bills and the expenses that name them). */
export function ordersFrom(orders: readonly PurchaseOrder[], bills: readonly Pick<Bill, "id" | "appRef" | "amount" | "date" | "poId">[], expenses: readonly Expense[], today: string): OrderView[] {
  const views = orders.map((o): OrderView => {
    const mine = bills.filter((b) => b.poId === o.id);
    const paidBy = expenses.filter((x) => x.kind === "expense" && x.poId === o.id);
    const amount = orderAmount(o);
    const billed = round(mine.reduce((n, b) => n + b.amount, 0));
    const paid = round(paidBy.reduce((n, x) => n + x.amount, 0));
    const open = o.status === "planned" || o.status === "ordered";
    const left = open ? round(Math.max(0, amount - billed - paid)) : 0;
    const done = !open || left <= 0;
    return {
      ...o,
      amount,
      billed,
      paid,
      left,
      bills: mine.map((b) => ({ id: b.id, appRef: b.appRef, amount: b.amount, date: b.date })).sort((a, b) => a.date.localeCompare(b.date)),
      payments: paidBy.map((x) => ({ id: x.id, ref: x.ref, amount: x.amount, date: x.date, method: x.method })).sort((a, b) => a.date.localeCompare(b.date)),
      late: !done && o.neededBy < today,
      done,
      unpriced: o.lines.some((l) => l.price !== null) ? o.lines.filter((l) => l.price === null).length : 0,
    };
  });
  // Still to buy first, the soonest needed first; then the done ones, newest first.
  return views.sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.done ? (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt) : a.neededBy.localeCompare(b.neededBy) || a.number.localeCompare(b.number))
  );
}

/** The day an order's money goes out: when it's to be paid, else when it's needed. */
export const payDay = (o: Pick<PurchaseOrder, "neededBy" | "payBy">) => o.payBy ?? o.neededBy;

/** The last day of a day's month ("End of the month"). */
export const monthEnd = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Where an order stands, in a few words. */
export function orderStage(o: OrderView): string {
  if (o.status === "cancelled") return "Cancelled";
  if (o.status === "closed") return o.billed || o.paid ? "Closed: the rest isn't needed" : "Closed";
  if (o.done) return o.billed && !o.paid ? "Billed in full" : o.paid && !o.billed ? "Paid in full" : "Billed and paid in full";
  const parts = [o.billed ? `${money0(o.billed)} billed` : "", o.paid ? `${money0(o.paid)} paid` : ""].filter(Boolean);
  if (parts.length) return `${parts.join(" · ")} · ${money0(o.left)} still to buy`;
  return o.status === "ordered" ? "Ordered, not billed or paid yet" : "To order";
}

const money0 = (n: number) => `GH₵ ${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const longDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The order to send the supplier on WhatsApp: its number to quote on their invoice, what, how many, the prices typed. */
export function orderText(o: Pick<OrderView, "number" | "supplier" | "lines" | "neededBy" | "payBy" | "note" | "amount" | "estimate">, today: string): string {
  const priced = o.lines.some((l) => l.price !== null);
  const head = [
    `*Purchase order ${o.number}*`,
    "The Lexington",
    o.supplier ? `To: ${o.supplier}` : "",
    `Date: ${longDate(today)}`,
    `Needed by: ${longDate(o.neededBy)}`,
    o.payBy && o.payBy !== o.neededBy ? `Payment: by ${longDate(o.payBy)}` : "",
  ];
  const items = o.lines.map((l) => {
    const qty = qtyWords(l);
    const price = l.price !== null ? ` @ ${money0(l.price)}${l.qty !== null && l.qty !== 1 ? ` = ${money0(lineTotal(l))}` : ""}` : "";
    return `• ${l.name}${qty ? `: ${qty}` : ""}${price}`;
  });
  return [head.filter(Boolean), items, priced ? [`Total: ${money0(o.amount)}`] : [], o.note ? [o.note] : [], [`Please put ${o.number} on your invoice.`]]
    .filter((block) => block.length > 0)
    .map((block) => block.join("\n"))
    .join("\n\n");
}
