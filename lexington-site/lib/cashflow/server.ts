import "server-only";

import { listBuyers } from "@/lib/buyers/payments";
import { listExpenses } from "@/lib/expenses/server";
import type { Expense } from "@/lib/expenses/shared";
import { listOrders } from "@/lib/orders/server";
import { linesText, ordersFrom } from "@/lib/orders/shared";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BANK_TEXT_PREFIX, BANK_TEXT_SETTINGS_ID, CASH_PLAN_PREFIX, CASHFLOW_ID, isId, newId, ROLLCALL_PREFIX } from "@/lib/site/ids";
import { getStore } from "@/lib/store/server";
import { ghanaDay } from "@/lib/store/shared";
import { toBuyLines } from "@/lib/store/shopping";
import { listBills } from "@/lib/suppliers/server";
import { suppliersFrom } from "@/lib/suppliers/shared";
import { cleanText, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { addDays, CURRENCIES, forecast, MAX_PLAN_WHAT, mondayOf, REPEATS, type CashflowInputs, type CashPlan, type Currency, type Forecast, type MoneyNow, type Repeat, type WageWeek } from "./shared";

// The cash flow (lib/cashflow/shared.ts says what and why). The money as last typed and the weekly wages figure are one
// document ("cashflow-live"); each plan typed is its own ("cashplan-live-*"). The rest is read from what the app
// already keeps: the bills, the purchase orders, the expenses since, the bank's waiting payments, the roll call's paydays.

type Data = Record<string, unknown>;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The company's own money: what the books get (lib/quickbooks/feed.ts). */
const COMPANY = new Set(["Site", "Event"]);

export interface CashflowPage {
  inputs: CashflowInputs;
  /** The bank's last text with a balance (the site's account), to start the bank's figure from. */
  bank: { balance: number; date: string; time: string } | null;
  /** The iPhone passes the bank's payment texts on too (not only money in). */
  debits: boolean;
  /** On the shopping list and on no order: no price, so not counted. */
  unpriced: number;
}

type Settings = { money?: MoneyNow | null; wagesWeekly?: number | null; leoWeekly?: number | null; rate?: number | null };
type RawPlan = Omit<CashPlan, "until" | "buyerId"> & { until?: string | null; buyerId?: string | null };

const PLAN_FIELDS = `{ "id": _id, direction, "what": coalesce(what, ""), amount, date, "repeat": coalesce(repeat, "once"), until, "currency": coalesce(currency, "GHS"), buyerId, createdAt, "createdBy": coalesce(createdBy, "") }`;

/** Money in from Leo (his transfers, the bank texts' "Leo"): the company's, never a buyer's. */
const fromLeo = (x: Expense) => x.kind === "inflow" && COMPANY.has(x.forWho) && /\bleo\b/i.test(x.supplier) && !/\(buyer\)/i.test(x.supplier);

/** Leo's money in by week, and the weekday he sends most lately (Monday first when it's a tie; Tuesday with nothing to go by). */
export function leoWeeks(expenses: readonly Expense[], thisWeek: string): { weeks: WageWeek[]; day: number } {
  const byWeek = new Map<string, number>();
  const days = new Map<number, number>();
  const since = addDays(thisWeek, -56);
  for (const x of expenses) {
    if (!fromLeo(x)) continue;
    const week = mondayOf(x.date);
    byWeek.set(week, Math.round(((byWeek.get(week) ?? 0) + x.amount) * 100) / 100);
    if (x.date >= since) {
      const day = new Date(`${x.date}T00:00:00Z`).getUTCDay();
      days.set(day, (days.get(day) ?? 0) + 1);
    }
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const day = days.size ? order.reduce((best, d) => ((days.get(d) ?? 0) > (days.get(best) ?? 0) ? d : best), order.find((d) => days.has(d)) ?? 2) : 2;
  return { weeks: [...byWeek].map(([week, paid]) => ({ week, paid })).sort((a, b) => a.week.localeCompare(b.week)), day };
}

/** A pay week's payments in the roll call (wages and the steel machines): what it paid in all. */
function weekPaid(json: string): number {
  try {
    const paid = (JSON.parse(json) as { paid?: Record<string, { amount?: unknown }> }).paid ?? {};
    return Math.round(Object.values(paid).reduce((n, p) => n + (p && typeof p.amount === "number" && p.amount > 0 ? p.amount : 0), 0) * 100) / 100;
  } catch {
    return 0;
  }
}

/** What went out and came in since the money was typed: the company's entries logged after it (a payday's lines paid after it). */
export function sinceTyped(expenses: readonly Expense[], at: string): { out: number; in: number; count: number } {
  const day = ghanaDay(at);
  let out = 0;
  let inn = 0;
  let count = 0;
  for (const x of expenses) {
    if (!COMPANY.has(x.forWho) || x.date < day) continue;
    // A payday's entry grows as each worker is paid: only the payments after the money was typed.
    const amount = x.payday ? x.payday.lines.filter((l) => l.at > at).reduce((n, l) => n + l.amount, 0) : x.createdAt > at ? x.amount : 0;
    if (!(amount > 0)) continue;
    if (x.kind === "inflow") inn += amount;
    else out += amount;
    count++;
  }
  return { out: Math.round(out * 100) / 100, in: Math.round(inn * 100) / 100, count };
}

/** Everything the cash flow is worked out from, as it is now. */
async function cashInputs(me: TodoMe | null): Promise<{ inputs: CashflowInputs; extra: Omit<CashflowPage, "inputs"> }> {
  const client = getBuyersClient();
  const today = ghanaDay();
  const thisWeek = mondayOf(today);
  const weeks = Array.from({ length: 9 }, (_, i) => addDays(thisWeek, -7 * i));
  const [settings, plans, bills, expenses, orders, paydays, bankSettings, store, buyersData] = await Promise.all([
    client.fetch<Settings | null>(`*[_id == $id][0]{ money, wagesWeekly, leoWeekly, rate }`, { id: CASHFLOW_ID }),
    client.fetch<RawPlan[]>(`*[_type == "cashPlan" && string::startsWith(_id, $prefix)] | order(date asc)[0...500] ${PLAN_FIELDS}`, { prefix: CASH_PLAN_PREFIX }),
    listBills(),
    listExpenses(),
    listOrders(),
    client.fetch<Array<{ key: string; json: string }>>(`*[_type == "rollcallDoc" && _id in $ids]{ key, json }`, { ids: weeks.map((w) => `${ROLLCALL_PREFIX}payments--${w}`) }),
    client.fetch<{ accounts?: string[] } | null>(`*[_id == $id][0]{ accounts }`, { id: BANK_TEXT_SETTINGS_ID }),
    me ? getStore(me) : Promise.resolve(null),
    listBuyers().catch(() => ({ buyers: [], lastRate: null })),
  ]);
  const money = settings?.money ?? null;
  const accounts = bankSettings?.accounts ?? [];
  const [pending, bank, debits] = await Promise.all([
    money
      ? client.fetch<number | null>(
          `math::sum(*[_type == "bankText" && string::startsWith(_id, $prefix) && direction == "debit" && result == "pending" && receivedAt > $at && (count($accounts) == 0 || account in $accounts)].amount)`,
          { prefix: BANK_TEXT_PREFIX, at: money.at, accounts }
        )
      : Promise.resolve(0),
    client.fetch<{ balance: number; date: string; time: string | null } | null>(
      `*[_type == "bankText" && string::startsWith(_id, $prefix) && defined(balance) && (count($accounts) == 0 || account in $accounts)] | order(date desc, coalesce(stamp, time) desc)[0]{ balance, date, time }`,
      { prefix: BANK_TEXT_PREFIX, accounts }
    ),
    client.fetch<number>(`count(*[_type == "bankText" && string::startsWith(_id, $prefix) && direction == "debit"][0...1])`, { prefix: BANK_TEXT_PREFIX }),
  ]);

  const owed = suppliersFrom([], bills, expenses, today).bills.filter((b) => b.left > 0);
  const open = ordersFrom(orders, bills, expenses, today).filter((o) => !o.done && (o.status === "planned" || o.status === "ordered"));
  const paid: WageWeek[] = paydays.map((d) => ({ week: d.key, paid: weekPaid(d.json) }));
  const taken = new Set(open.flatMap((o) => o.lines.map((l) => l.buyId ?? l.itemId)).filter(Boolean));
  const leo = leoWeeks(expenses, thisWeek);
  const inputs: CashflowInputs = {
    today,
    money,
    since: { ...(money ? sinceTyped(expenses, money.at) : { out: 0, in: 0, count: 0 }), pending: Math.round((pending ?? 0) * 100) / 100 },
    wages: { weeks: paid.filter((w) => w.week !== thisWeek), thisWeek: paid.find((w) => w.week === thisWeek)?.paid ?? 0, typed: settings?.wagesWeekly ?? null },
    bills: owed.map((b) => ({ id: b.id, vendorId: b.vendorId, appRef: b.appRef, supplier: b.supplier, description: b.description, due: b.due, left: b.left })),
    orders: open.map((o) => ({ id: o.id, number: o.number, supplier: o.supplier, what: linesText(o.lines) || o.note, neededBy: o.neededBy, payBy: o.payBy, left: o.left, status: o.status as "planned" | "ordered" })),
    plans: plans.map((p) => ({ ...p, until: p.until ?? null, currency: p.currency === "USD" ? "USD" : "GHS", buyerId: p.buyerId ?? null })),
    leo: { weeks: leo.weeks.filter((w) => w.week !== thisWeek), thisWeek: leo.weeks.find((w) => w.week === thisWeek)?.paid ?? 0, typed: settings?.leoWeekly ?? null, day: leo.day },
    buyers: buyersData.buyers.filter((b) => b.balanceUSD > 0.005).map((b) => ({ id: b.id, name: b.name, balanceUSD: Math.round(b.balanceUSD * 100) / 100 })),
    rate: { typed: settings?.rate ?? null, last: buyersData.lastRate ?? null },
  };
  return {
    inputs,
    extra: {
      bank: bank ? { balance: bank.balance, date: bank.date, time: bank.time ?? "" } : null,
      debits: debits > 0,
      unpriced: store ? toBuyLines(store.items, store.tools, store.buys).filter((l) => !taken.has(l.kind === "buy" ? l.buy.id : l.item.id) && !(l.kind === "buy" && l.buy.itemId && taken.has(l.buy.itemId))).length : 0,
    },
  };
}

/** The cash flow page: what it's worked out from (the page works out the weeks itself, as many as asked). */
export async function cashflowPage(me: TodoMe): Promise<CashflowPage> {
  const { inputs, extra } = await cashInputs(me);
  return { inputs, ...extra };
}

/** The home page's tile: the weeks ahead worked out here. */
export async function cashflowNow(): Promise<{ forecast: Forecast; typedAt: string | null }> {
  const { inputs } = await cashInputs(null);
  return { forecast: forecast(inputs), typedAt: inputs.money?.at ?? null };
}

/* ---------- what's typed ---------- */

function cleanMoney(value: unknown, message: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(String(value).replace(/[,\s]/g, "")) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new TodoError(400, message);
  return n;
}
function cleanDay(value: unknown, message: string): string {
  if (typeof value !== "string" || !DAY_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new TodoError(400, message);
  return value;
}

/**
 *   { action: "money", bank, cash }   the money there is now (from here on, each entry logged moves it)
 *   { action: "wages", weekly }       the wages each Saturday (null: the last paydays' average)
 *   { action: "leo", weekly }         what Leo sends a week (null: his last weeks' average)
 *   { action: "rate", rate }          GH₵ for one US$ (null: the last buyer payment's)
 *   { action: "plan", id?, direction, what, amount, date, repeat, until?, currency?, buyerId? }   money in or out expected
 *   { action: "deleteplan", id }
 */
export async function changeCashflow(me: TodoMe, body: Data): Promise<void> {
  const client = getBuyersClient();
  if (body.action === "money") {
    const bank = cleanMoney(body.bank, "Type what's in the bank as a number, e.g. 120000.");
    const cash = cleanMoney(body.cash, "Type the cash and MoMo on hand as a number, e.g. 8000.");
    if (bank === null && cash === null) throw new TodoError(400, "Type what's in the bank, the cash on hand, or both.");
    const money: MoneyNow = { bank, cash, amount: Math.round(((bank ?? 0) + (cash ?? 0)) * 100) / 100, at: new Date().toISOString(), by: me.name };
    await client.createIfNotExists({ _id: CASHFLOW_ID, _type: "cashflowSettings" });
    await client.patch(CASHFLOW_ID).set({ money }).commit();
    return;
  }
  if (body.action === "wages") {
    const weekly = cleanMoney(body.weekly, "Type the wages for a week as a number, e.g. 25000.");
    if (weekly !== null && !(weekly > 0)) throw new TodoError(400, "Type the wages for a week, or use the average.");
    await client.createIfNotExists({ _id: CASHFLOW_ID, _type: "cashflowSettings" });
    await (weekly === null ? client.patch(CASHFLOW_ID).unset(["wagesWeekly"]) : client.patch(CASHFLOW_ID).set({ wagesWeekly: weekly })).commit();
    return;
  }
  if (body.action === "leo") {
    const weekly = cleanMoney(body.weekly, "Type what Leo sends in a week as a number, e.g. 150000.");
    if (weekly !== null && !(weekly > 0)) throw new TodoError(400, "Type what Leo sends in a week, or use the average.");
    await client.createIfNotExists({ _id: CASHFLOW_ID, _type: "cashflowSettings" });
    await (weekly === null ? client.patch(CASHFLOW_ID).unset(["leoWeekly"]) : client.patch(CASHFLOW_ID).set({ leoWeekly: weekly })).commit();
    return;
  }
  if (body.action === "rate") {
    const rate = cleanMoney(body.rate, "Type the rate as GH₵ for one US$, e.g. 11.7.");
    if (rate !== null && !(rate > 0.5 && rate < 1000)) throw new TodoError(400, "Type the rate as GH₵ for one US$, e.g. 11.7.");
    await client.createIfNotExists({ _id: CASHFLOW_ID, _type: "cashflowSettings" });
    await (rate === null ? client.patch(CASHFLOW_ID).unset(["rate"]) : client.patch(CASHFLOW_ID).set({ rate })).commit();
    return;
  }
  if (body.action === "plan") {
    const direction = body.direction === "in" ? "in" : body.direction === "out" ? "out" : null;
    if (!direction) throw new TodoError(400, "Pick money in or a payment.");
    const what = cleanText(body.what, MAX_PLAN_WHAT, "description").replace(/\s+/g, " ");
    if (!what) throw new TodoError(400, direction === "in" ? "Say who it's from, e.g. Leo." : "Say what it's for, e.g. Security guard.");
    const amount = cleanMoney(body.amount, "Type the amount as a number, e.g. 50000.");
    if (!amount) throw new TodoError(400, "Type the amount.");
    const date = cleanDay(body.date, "Pick the day.");
    const repeat = (REPEATS as readonly string[]).includes(String(body.repeat ?? "once")) ? (String(body.repeat ?? "once") as Repeat) : null;
    if (!repeat) throw new TodoError(400, "Pick once, every week or every month.");
    const until = repeat !== "once" && body.until ? cleanDay(body.until, "Pick the last day it repeats.") : null;
    if (until && until < date) throw new TodoError(400, "It can't stop before it starts.");
    const currency: Currency = (CURRENCIES as readonly string[]).includes(String(body.currency ?? "GHS")) ? (String(body.currency ?? "GHS") as Currency) : "GHS";
    // A buyer's payments: theirs (one still paying), in dollars, money in.
    let buyerId: string | null = null;
    if (body.buyerId !== undefined && body.buyerId !== null && body.buyerId !== "") {
      const buyer = (await listBuyers()).buyers.find((b) => b.id === body.buyerId);
      if (!buyer) throw new TodoError(404, "That buyer isn't there any more. Refresh the page.");
      if (direction !== "in" || currency !== "USD") throw new TodoError(400, "A buyer's payments are money in, in US$.");
      buyerId = buyer.id;
    }
    const fields = { direction, what, amount, date, repeat, until, currency, buyerId, updatedAt: new Date().toISOString(), updatedBy: me.name };
    if (body.id !== undefined) {
      if (!isId(CASH_PLAN_PREFIX, body.id)) throw new TodoError(404, "That isn't there any more. Refresh the page.");
      const there = await client.fetch<number>(`count(*[_id == $id])`, { id: body.id });
      if (!there) throw new TodoError(404, "That isn't there any more. Refresh the page.");
      await client.patch(body.id).set(fields).commit();
    } else {
      await client.create({ _id: newId(CASH_PLAN_PREFIX), _type: "cashPlan", ...fields, createdAt: new Date().toISOString(), createdBy: me.name });
    }
    return;
  }
  if (body.action === "deleteplan") {
    if (!isId(CASH_PLAN_PREFIX, body.id)) throw new TodoError(404, "That isn't there any more. Refresh the page.");
    await client.delete(body.id);
    return;
  }
  throw new TodoError(400, "That button isn't known.");
}
