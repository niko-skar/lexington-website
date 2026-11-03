import "server-only";

import { unreadCount } from "@/lib/alerts/notify";
import { listBuyers } from "@/lib/buyers/payments";
import { listConcrete } from "@/lib/concrete/server";
import { daySummary, truckFlags, trucksOn } from "@/lib/concrete/shared";
import { rollcallAccess } from "@/lib/rollcall/shared";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BANK_TEXT_PREFIX, BILL_PREFIX, EXPENSE_PREFIX, QBO_HISTORY_ID, QBO_TXN_MONTH_PREFIX, ROLLCALL_PREFIX } from "@/lib/site/ids";
import { steelData } from "@/lib/steel/server";
import { getStore } from "@/lib/store/server";
import { ghanaDay, needsReorder, stillOut } from "@/lib/store/shared";
import { suppliersOwed } from "@/lib/suppliers/server";
import { listTasks } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";

// The site app's home page (30 Oct 2026): how each part this login opens stands today, in a line or two.
// Each part answers on its own, so one that can't be read leaves the others showing.

export interface SlotCount {
  here: number;
  marked: number;
}

export interface DashboardData {
  /** Today in Ghana, YYYY-MM-DD. */
  today: string;
  todo?: { open: number; urgent: number; doneToday: number };
  store?: { reorders: number; toolsOut: number; opened: string | null; closed: string | null; toCheck?: number; toFix: number; atRepairer: number };
  /** Spent on site this month, and the bank's debits waiting to be completed. */
  expenses?: { monthOut: number; monthCount: number; fromBank: number };
  alerts?: { unread: number };
  rollcall?: { morning: SlotCount; afternoon: SlotCount; closing: SlotCount; onBooks: number; curing: number; checklists: number };
  payday?: { weekStart: string; paid: number; worked: number };
  workers?: { active: number };
  /** Buyers: what they've paid of their prices (US$), and the latest payment. */
  buyers?: { count: number; paidUSD: number; priceUSD: number; last: { date: string | null; name: string; receipt: string | null } | null };
  /** Suppliers: what their open bills still want, how many are open and overdue, the next due (lib/suppliers). */
  suppliers?: { owed: number; open: number; overdue: number; nextDue: string | null; suppliers: number };
  /** Spending: this month and this year, QuickBooks' and the app's own not there yet (lib/spending). */
  spending?: { month: number; year: number; read: string | null };
  /** Concrete trucks: today's (with how many don't add up), else the last pour day's. */
  concrete?: { day: string | null; trucks: number; volume: number; flagged: number };
  /** Steel: the tons bought, installed and in stock; what the steel benders were paid and are owed (below 0: paid ahead); the buys with no tons. */
  steel?: { bought: number; installed: number; stock: number; paid: number; owed: number; unknown: number };
  /** The roll call isn't moved in from its Claude page yet (one tile says so instead of three empty ones). */
  rollcallMoving?: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The Monday of a day's week (the roll call's pay week runs Monday to Saturday). */
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const settle = async <T>(work: Promise<T>): Promise<T | undefined> => {
  try {
    return await work;
  } catch (error) {
    console.error("[dashboard]", error instanceof Error ? error.message : error);
    return undefined;
  }
};

async function todoPart(me: TodoMe, today: string) {
  const tasks = await listTasks(me);
  const open = tasks.filter((t) => t.status !== "done");
  return { open: open.length, urgent: open.filter((t) => t.urgent).length, doneToday: tasks.filter((t) => t.doneAt && ghanaDay(t.doneAt) === today).length };
}

async function storePart(me: TodoMe, today: string) {
  const store = await getStore(me);
  const checksToday = store.checks.filter((c) => ghanaDay(c.at) === today);
  const at = (kind: string) => checksToday.filter((c) => c.kind === kind).sort((a, b) => a.at.localeCompare(b.at))[0]?.at ?? null;
  return {
    reorders: store.items.filter(needsReorder).length,
    // The office: new things the site logins added, to check.
    ...(me.kind === "admin" ? { toCheck: [...store.items, ...store.tools].filter((x) => x.review).length } : {}),
    toolsOut: store.toolOuts.reduce((n, o) => n + stillOut(o), 0),
    // Tools broken or needing repair: still to send out, and at the repairer.
    toFix: store.repairs.filter((r) => r.state === "waiting").reduce((n, r) => n + r.qty, 0),
    atRepairer: store.repairs.filter((r) => r.state === "away").reduce((n, r) => n + r.qty, 0),
    opened: at("open"),
    closed: at("close"),
  };
}

async function expensesPart(today: string) {
  const from = `${today.slice(0, 7)}-01`;
  return getBuyersClient().fetch<{ monthOut: number | null; monthCount: number; fromBank: number }>(
    `{
      "fromBank": count(*[_type == "bankText" && string::startsWith(_id, $bank) && direction == "debit" && result == "pending"]),
      "monthOut": math::sum(*[_type == "siteExpense" && string::startsWith(_id, $prefix) && coalesce(kind, "expense") == "expense" && coalesce(forWho, "Site") == "Site" && date >= $from].amount),
      "monthCount": count(*[_type == "siteExpense" && string::startsWith(_id, $prefix) && coalesce(kind, "expense") == "expense" && coalesce(forWho, "Site") == "Site" && date >= $from])
    }`,
    { prefix: EXPENSE_PREFIX, bank: BANK_TEXT_PREFIX, from }
  ).then((r) => ({ monthOut: r.monthOut ?? 0, monthCount: r.monthCount, fromBank: r.fromBank }));
}

async function rollcallParts(me: TodoMe, today: string): Promise<Pick<DashboardData, "rollcall" | "payday" | "workers" | "rollcallMoving">> {
  const can = rollcallAccess(me.sections);
  const week = mondayOf(today);
  const days = [0, 1, 2, 3, 4, 5].map((i) => addDays(week, i));
  const id = (col: string, key: string) => `${ROLLCALL_PREFIX}${col}--${key}`;
  const rows = await getBuyersClient().fetch<Array<{ col: string; key: string; json: string }>>(
    `*[_type == "rollcallDoc" && string::startsWith(_id, $prefix) && (col in ["workers", "pours"] || _id in $ids)]{ col, key, json }`,
    { prefix: ROLLCALL_PREFIX, ids: [...days, today].map((d) => id("days", d)).concat(id("payments", week)) }
  );
  const docs = rows.map((r) => ({ ...r, data: JSON.parse(r.json) as Obj }));
  if (!docs.some((d) => d.col === "workers")) return { rollcallMoving: true };
  const workers =docs.filter((d) => d.col === "workers").map((d) => ({ id: d.key, active: d.data.active, trade: d.data.trade }));
  const active = workers.filter((w) => w.active !== false);
  const steel = new Set(workers.filter((w) => w.trade === "steel").map((w) => w.id));
  const marksOn = (day: string) => {
    const doc = docs.find((d) => d.col === "days" && d.key === day)?.data;
    return isObj(doc?.marks) ? (doc.marks as Record<string, Obj>) : {};
  };
  const marks = marksOn(today);
  const slot = (s: string): SlotCount => {
    let here = 0;
    let marked = 0;
    for (const m of Object.values(marks)) {
      const x = isObj(m) ? m[s] : null;
      if (isObj(x) && x.s) {
        marked++;
        if (x.s === "in") here++;
      }
    }
    return { here, marked };
  };
  // Curing today: a live pour (not still being checked) whose days include today.
  const pours = docs.filter((d) => d.col === "pours" && !d.data.deleted).map((d) => d.data);
  const curing = pours.filter((p) => {
    if (p.phase === "check" || typeof p.start !== "string") return false;
    const last = addDays(p.start, Math.max(1, Math.round(Number(p.days) || 7)) - 1);
    const end = typeof p.stopped === "string" && p.stopped < last ? p.stopped : last;
    return p.start <= today && today <= end;
  }).length;

  const out: Pick<DashboardData, "rollcall" | "payday" | "workers" | "rollcallMoving"> = {};
  if (can.rollcall) {
    out.rollcall = {
      morning: slot("m"),
      afternoon: slot("a"),
      closing: slot("c"),
      onBooks: active.length,
      curing,
      checklists: pours.filter((p) => p.phase === "check").length,
    };
  }
  if (can.payday) {
    const pay = docs.find((d) => d.col === "payments" && d.key === week)?.data;
    const paid = isObj(pay?.paid) ? Object.entries(pay.paid as Obj).filter(([k, v]) => k !== "machines" && v).length : 0;
    const worked = new Set(days.flatMap((d) => Object.keys(marksOn(d)).filter((wid) => !steel.has(wid))));
    out.payday = { weekStart: week, paid, worked: worked.size };
  }
  if (can.workers) out.workers = { active: active.length };
  return out;
}

async function concretePart(today: string): Promise<NonNullable<DashboardData["concrete"]>> {
  const { trucks, days } = await listConcrete();
  const day = trucks.some((t) => t.day === today) ? today : (trucks[0]?.day ?? null);
  if (!day) return { day: null, trucks: 0, volume: 0, flagged: 0 };
  const list = trucksOn(trucks, day);
  const pour = days.find((d) => d.day === day);
  const sum = daySummary(list);
  return { day, trucks: sum.trucks, volume: sum.volume, flagged: list.filter((t) => truckFlags(t, trucks, pour).some((f) => f.tone === "bad")).length };
}

async function buyersPart(): Promise<NonNullable<DashboardData["buyers"]>> {
  const { buyers } = await listBuyers();
  const latest = buyers
    .flatMap((x) => (x.payments[0] ? [{ date: x.payments[0].date, name: x.name, receipt: x.payments[0].receipt }] : []))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
  return {
    count: buyers.length,
    paidUSD: Math.round(buyers.reduce((n, x) => n + x.paidUSD, 0)),
    priceUSD: Math.round(buyers.reduce((n, x) => n + x.priceUSD, 0)),
    last: latest ?? null,
  };
}

async function steelPart(me: TodoMe): Promise<NonNullable<DashboardData["steel"]>> {
  const { tracker: x } = await steelData(me);
  return { bought: x.tons, installed: x.installed, stock: x.stock, paid: x.paid, owed: x.owed, unknown: x.unknown };
}

/** The home page's figures for this login: only the parts it opens. */
export async function getDashboard(me: TodoMe): Promise<DashboardData> {
  const today = ghanaDay();
  const has = (s: string) => me.sections.includes(s as never);
  const [todo, store, expenses, unread, rollcall, concrete, buyers, suppliers, steel, spending] = await Promise.all([
    has("todo") ? settle(todoPart(me, today)) : undefined,
    has("store") ? settle(storePart(me, today)) : undefined,
    has("expenses") ? settle(expensesPart(today)) : undefined,
    has("alerts") ? settle(unreadCount()) : undefined,
    has("rollcall") || has("payday") || has("workers") ? settle(rollcallParts(me, today)) : undefined,
    has("concrete") ? settle(concretePart(today)) : undefined,
    has("buyers") ? settle(buyersPart()) : undefined,
    has("suppliers") ? settle(suppliersOwed()) : undefined,
    has("steel") ? settle(steelPart(me)) : undefined,
    has("spending") ? settle(spendingPart(today)) : undefined,
  ]);
  return {
    today,
    ...(todo ? { todo } : {}),
    ...(store ? { store } : {}),
    ...(expenses ? { expenses } : {}),
    ...(unread !== undefined ? { alerts: { unread } } : {}),
    ...(rollcall ?? {}),
    ...(concrete ? { concrete } : {}),
    ...(buyers ? { buyers } : {}),
    ...(steel ? { steel } : {}),
    ...(suppliers ? { suppliers } : {}),
    ...(spending ? { spending } : {}),
  };
}

/**
 * The Spending tile, light: QuickBooks' month totals (kept with each month read from the books) and the app's own
 * entries not sent to QuickBooks yet. (The page itself adds up every entry; just sent ones show there after the
 * next read.)
 */
async function spendingPart(today: string): Promise<NonNullable<DashboardData["spending"]>> {
  const month = today.slice(0, 7);
  const year = `${today.slice(0, 4)}-01`;
  const x = await getBuyersClient().fetch<{ qMonth: number | null; qYear: number | null; aMonth: number | null; aYear: number | null; bMonth: number | null; bYear: number | null; read: string | null }>(
    `{
      "qMonth": math::sum(*[_type == "qboTxnMonth" && string::startsWith(_id, $txnPrefix) && month == $month].costs),
      "qYear": math::sum(*[_type == "qboTxnMonth" && string::startsWith(_id, $txnPrefix) && month >= $year && month <= $month].costs),
      "aMonth": math::sum(*[_type == "siteExpense" && string::startsWith(_id, $expPrefix) && coalesce(kind, "expense") == "expense" && coalesce(forWho, "Site") in ["Site", "Event"] && !defined(billId) && !defined(qbo.txnId) && date >= $monthStart].amount),
      "aYear": math::sum(*[_type == "siteExpense" && string::startsWith(_id, $expPrefix) && coalesce(kind, "expense") == "expense" && coalesce(forWho, "Site") in ["Site", "Event"] && !defined(billId) && !defined(qbo.txnId) && date >= $yearStart].amount),
      "bMonth": math::sum(*[_type == "supplierBill" && string::startsWith(_id, $billPrefix) && !coalesce(deleted, false) && !defined(qbo.txnId) && date >= $monthStart].amount),
      "bYear": math::sum(*[_type == "supplierBill" && string::startsWith(_id, $billPrefix) && !coalesce(deleted, false) && !defined(qbo.txnId) && date >= $yearStart].amount),
      "read": *[_id == $historyId][0].fetchedAt
    }`,
    {
      txnPrefix: QBO_TXN_MONTH_PREFIX,
      expPrefix: EXPENSE_PREFIX,
      billPrefix: BILL_PREFIX,
      historyId: QBO_HISTORY_ID,
      month,
      year,
      monthStart: `${month}-01`,
      yearStart: `${year}-01`,
    }
  );
  const n = (v: number | null) => Number(v) || 0;
  return { month: n(x.qMonth) + n(x.aMonth) + n(x.bMonth), year: n(x.qYear) + n(x.aYear) + n(x.bYear), read: x.read };
}
