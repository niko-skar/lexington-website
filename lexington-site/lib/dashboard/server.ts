import "server-only";

import { unreadCount } from "@/lib/alerts/notify";
import { rollcallAccess } from "@/lib/rollcall/shared";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { EXPENSE_PREFIX, ROLLCALL_PREFIX } from "@/lib/site/ids";
import { getStore } from "@/lib/store/server";
import { ghanaDay, needsReorder, stillOut } from "@/lib/store/shared";
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
  store?: { reorders: number; toolsOut: number; opened: string | null; closed: string | null };
  expenses?: { monthOut: number; monthCount: number };
  alerts?: { unread: number };
  rollcall?: { morning: SlotCount; afternoon: SlotCount; closing: SlotCount; onBooks: number; curing: number; checklists: number };
  payday?: { weekStart: string; paid: number; worked: number };
  workers?: { active: number };
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
    toolsOut: store.toolOuts.reduce((n, o) => n + stillOut(o), 0),
    opened: at("open"),
    closed: at("close"),
  };
}

async function expensesPart(today: string) {
  const from = `${today.slice(0, 7)}-01`;
  return getBuyersClient().fetch<{ monthOut: number | null; monthCount: number }>(
    `{
      "monthOut": math::sum(*[_type == "siteExpense" && string::startsWith(_id, $prefix) && coalesce(kind, "expense") == "expense" && coalesce(forWho, "Site") == "Site" && date >= $from].amount),
      "monthCount": count(*[_type == "siteExpense" && string::startsWith(_id, $prefix) && coalesce(kind, "expense") == "expense" && coalesce(forWho, "Site") == "Site" && date >= $from])
    }`,
    { prefix: EXPENSE_PREFIX, from }
  ).then((r) => ({ monthOut: r.monthOut ?? 0, monthCount: r.monthCount }));
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

/** The home page's figures for this login: only the parts it opens. */
export async function getDashboard(me: TodoMe): Promise<DashboardData> {
  const today = ghanaDay();
  const has = (s: string) => me.sections.includes(s as never);
  const [todo, store, expenses, unread, rollcall] = await Promise.all([
    has("todo") ? settle(todoPart(me, today)) : undefined,
    has("store") ? settle(storePart(me, today)) : undefined,
    has("expenses") ? settle(expensesPart(today)) : undefined,
    has("alerts") ? settle(unreadCount()) : undefined,
    has("rollcall") || has("payday") || has("workers") ? settle(rollcallParts(me, today)) : undefined,
  ]);
  return {
    today,
    ...(todo ? { todo } : {}),
    ...(store ? { store } : {}),
    ...(expenses ? { expenses } : {}),
    ...(unread !== undefined ? { alerts: { unread } } : {}),
    ...(rollcall ?? {}),
  };
}
