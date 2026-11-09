import "server-only";

import { MATERIALS, countIn } from "@/lib/analysis/shared";
import { listExpenses } from "@/lib/expenses/server";
import { FLOORS } from "@/lib/expenses/shared";
import { listOrders, moveOrder, saveOrder } from "@/lib/orders/server";
import { ordersFrom, type OrderStatus } from "@/lib/orders/shared";
import { classNamed } from "@/lib/quickbooks/books";
import { cachedBookLists } from "@/lib/quickbooks/booksCache";
import { cachedVendors } from "@/lib/quickbooks/vendors";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { EXPENSE_PREFIX, ORDER_PREFIX } from "@/lib/site/ids";
import { ghanaDay } from "@/lib/store/shared";
import { listBills } from "@/lib/suppliers/server";
import { TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";

// A booked pour's purchase order (Niko, 9 Nov 2026: "can you add the concrete booking when I make it as a purchase
// order at the same time with the cost already put in"): one order per pour, from the concrete company, for its m³ at
// the price per m³, needed on the pour's day, so Finance's orders and the cash flow have it the moment it's booked. It
// follows its pour while nothing has billed or paid it: changed with it, ordered when the order goes on WhatsApp,
// cancelled when the pour is taken off. The order keeps the pour's id ("pourId").

export interface PourPO {
  id: string;
  number: string;
  amount: number;
  /** GH₵ per m³ (the first priced line's). */
  price: number | null;
  status: OrderStatus;
  /** Billed or paid in full, closed or cancelled. */
  done: boolean;
}

const CONCRETE = MATERIALS.find((m) => m.key === "concrete")!;
const round2 = (n: number) => Math.round(n * 100) / 100;
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const money = (n: number) => `GH₵ ${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

/**
 * A m³ of ready-mix as it last cost: the last pour's purchase order (its price as typed), else the last ready-mix in the
 * expenses (its money over the m³ its words say: "36 m³ ready mix concrete 35MPa with pump" for GH₵ 54,468).
 */
export async function concretePrice(): Promise<{ price: number; from: string } | null> {
  const client = getBuyersClient();
  const po = await client.fetch<{ number: string; neededBy: string; price: number | null } | null>(
    `*[_type == "purchaseOrder" && string::startsWith(_id, $prefix) && defined(pourId) && status != "cancelled"] | order(createdAt desc)[0]{ number, neededBy, "price": lines[defined(price)][0].price }`,
    { prefix: ORDER_PREFIX }
  );
  if (po?.price && po.price > 0) return { price: po.price, from: `as on ${po.number} (${shortDay(po.neededBy)})` };
  const rows = await client.fetch<Array<{ date: string; amount: number; description?: string; supplier?: string }>>(
    `*[_type == "siteExpense" && string::startsWith(_id, $prefix) && kind == "expense" && amount > 0] | order(date desc)[0...120]{ date, amount, description, supplier }`,
    { prefix: EXPENSE_PREFIX }
  );
  for (const r of rows) {
    const text = r.description ?? "";
    if (!CONCRETE.words.test(text) || CONCRETE.not?.test(text)) continue;
    const m3 = countIn(text, CONCRETE, r.amount);
    if (!m3 || m3 <= 0) continue;
    return { price: round2(r.amount / m3), from: `${r.supplier || "Ready-mix"}, ${shortDay(r.date)}: ${m3} m³ for ${money(r.amount)}` };
  }
  return null;
}

/** Each pour's purchase order, by pour. */
export async function pourOrders(pourIds: string[]): Promise<Map<string, PourPO>> {
  const out = new Map<string, PourPO>();
  if (!pourIds.length) return out;
  const rows = await getBuyersClient().fetch<Array<{ id: string; pourId: string; number: string; status: OrderStatus; lines: Array<{ qty?: number | null; price?: number | null }> }>>(
    `*[_type == "purchaseOrder" && string::startsWith(_id, $prefix) && pourId in $ids] | order(createdAt asc){ "id": _id, pourId, number, "status": coalesce(status, "planned"), "lines": coalesce(lines[]{ qty, price }, []) }`,
    { prefix: ORDER_PREFIX, ids: pourIds }
  );
  for (const r of rows) {
    const priced = r.lines.filter((l) => typeof l.price === "number");
    const amount = round2(priced.reduce((n, l) => n + (l.qty ?? 1) * (l.price as number), 0));
    // A pour cancelled and booked again has a new order: the newest open one wins.
    const done = r.status === "closed" || r.status === "cancelled";
    if (out.has(r.pourId) && done) continue;
    out.set(r.pourId, { id: r.id, number: r.number, amount, price: priced[0]?.price ?? null, status: r.status, done });
  }
  return out;
}

/** The pour's order as it stands, with what has billed and paid it. */
async function pourOrderView(pourId: string) {
  const id = await getBuyersClient().fetch<string | null>(
    `*[_type == "purchaseOrder" && string::startsWith(_id, $prefix) && pourId == $pourId && !(status in ["closed", "cancelled"])] | order(createdAt desc)[0]._id`,
    { prefix: ORDER_PREFIX, pourId }
  );
  if (!id) return null;
  const order = (await listOrders()).find((o) => o.id === id);
  if (!order) return null;
  const [view] = ordersFrom([order], await listBills(), await listExpenses(), ghanaDay());
  return view;
}

/** "35mpa" or "C35" as "C35"; anything else as typed. */
function grade(mix: string): string {
  const n = /(\d{2})/.exec(mix)?.[1];
  return /^c\s*\d{2}/i.test(mix.trim()) ? mix.trim().toUpperCase().replace(/\s+/g, "") : n ? `C${n}` : mix.trim();
}

/** The floor or stage its words name ("1st floor columns", "2nd floor slab"), as the books have them. */
function floorIn(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bground\b/.test(t)) return "Ground floor";
  if (/\bbasement\b/.test(t)) return "Basement";
  if (/\broof\b/.test(t)) return "Roof";
  const n = /\b([1-7])(?:st|nd|rd|th)\b/.exec(t)?.[1];
  return n ? (FLOORS.find((f) => f.startsWith(n)) ?? null) : null;
}

/** The concrete company in QuickBooks' suppliers: the one its name says (Consar unless said). */
async function vendorFor(name: string): Promise<{ id: string; name: string } | null> {
  const word = (name.trim().split(/\s+/)[0] || "Consar").toLowerCase();
  const { vendors } = await cachedVendors();
  return vendors.find((v) => v.name.toLowerCase().split(/[^a-z0-9]+/).includes(word)) ?? vendors.find((v) => v.name.toLowerCase().startsWith(word)) ?? null;
}

export interface PourForOrder {
  id: string;
  what: string;
  day: string;
  mix: string;
}

/**
 * The pour's order made, or changed to match it: a line per part ("Concrete C35: 1st floor columns", its m³ at the price
 * per m³). Nothing when there's no m³ or no price. An order something has billed or paid is left as it is. `ordered`: the
 * order went to the concrete company (WhatsApp), so the purchase order is placed.
 */
export async function syncPourOrder(
  me: TodoMe,
  pour: PourForOrder,
  lines: Array<{ label: string; m3: number }>,
  price: number | null,
  opts: { supplier?: string; ordered?: boolean; fallbackPrice?: number | null } = {}
): Promise<void> {
  const parts = lines.filter((l) => l.m3 > 0);
  const view = await pourOrderView(pour.id);
  if (view && (view.billed > 0 || view.paid > 0)) return;
  // The price typed, else the order's own, else (a pour booked before orders came with it) as it last cost.
  const each = price ?? view?.lines.find((l) => l.price !== null)?.price ?? opts.fallbackPrice ?? null;
  if (!parts.length || !each || !(each > 0)) return;
  const vendor = (opts.supplier ? await vendorFor(opts.supplier) : null) ?? (view?.vendorId ? { id: view.vendorId, name: view.supplier } : await vendorFor("Consar"));
  const books = await cachedBookLists().catch(() => ({ classes: [], locations: [] }));
  const costClass = classNamed("Concrete Ready Mix", books.classes);
  const g = grade(pour.mix);
  const body = {
    ...(view ? { id: view.id } : {}),
    vendorId: vendor?.id ?? null,
    category: "Material",
    lines: parts.map((l, i) => ({ key: `c${i + 1}`, name: `Concrete${g ? ` ${g}` : ""}: ${l.label}`.slice(0, 80), qty: l.m3, unit: "m³", price: each })),
    estimate: null,
    neededBy: pour.day,
    payBy: view?.payBy ?? null,
    note: `Concrete pour booked for ${shortDay(pour.day)}: ${pour.what}`.slice(0, 300),
    floor: floorIn(parts[0].label) ?? floorIn(pour.what),
    costClass: costClass ? { id: costClass.id, name: costClass.name } : null,
  };
  const id = await saveOrder(me, body);
  if (!view) await getBuyersClient().patch(id).set({ pourId: pour.id }).commit();
  if (opts.ordered && (view?.status ?? "planned") === "planned" && body.vendorId) {
    await moveOrder(me, { action: "ordered", id }).catch((e) => {
      if (!(e instanceof TodoError)) throw e;
    });
  }
}

/** The pour taken off: its order too, while nothing has billed or paid it. */
export async function cancelPourOrder(me: TodoMe, pourId: string): Promise<void> {
  const view = await pourOrderView(pourId);
  if (!view || view.billed > 0 || view.paid > 0) return;
  await moveOrder(me, { action: "cancel", id: view.id });
}
