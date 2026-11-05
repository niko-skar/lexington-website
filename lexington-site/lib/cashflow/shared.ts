// The cash flow (Niko, 5 Nov 2026: "a cashflow tab where I can estimate based on our current balance and what needs
// to be bought and when" ... "it should estimate the weeks payroll into the cashflow"). It starts from the money now:
// the bank and the cash on hand as last typed, then every entry logged since, out or in (and the bank's payments still
// waiting to be completed). Then week by week what's coming: the wages each Saturday (the last paydays' average, or the
// weekly figure typed), the suppliers' bills on their due dates, the purchase orders on the day they're needed, and
// the money in or out typed as expected. Only the company's money counts (Site and Event entries, as in the books):
// the House and Niko's own never do. Kept apart from the server so it can be checked on its own.

/** Payday: Saturday (the roll call pays the week, Monday to Saturday, that day). */
export const PAYDAY = 6;
/** The wages estimate: the average of the last few paydays. */
export const WAGE_WEEKS = 4;
/** Weeks shown at first, and at most. */
export const WEEKS = 8;
export const MAX_WEEKS = 26;
export const REPEATS = ["once", "week", "month"] as const;
export type Repeat = (typeof REPEATS)[number];
export const MAX_PLAN_WHAT = 80;

/** Money in or out expected, typed (Leo's next transfer, a buyer's instalment, the rent). */
export interface CashPlan {
  id: string;
  direction: "in" | "out";
  what: string;
  amount: number;
  /** YYYY-MM-DD: the day (the first one, when it repeats). */
  date: string;
  repeat: Repeat;
  /** The last day it repeats until (null: on and on). */
  until: string | null;
  createdAt: string;
  createdBy: string;
}

/** The money as last typed: the bank, the cash and MoMo on hand, and when. */
export interface MoneyNow {
  bank: number | null;
  cash: number | null;
  amount: number;
  /** When it was typed (ISO): entries logged after it move it. */
  at: string;
  by: string;
}

/** What a pay week paid (the roll call's Payday, wages and the steel machines). */
export interface WageWeek {
  /** The week's Monday, YYYY-MM-DD. */
  week: string;
  paid: number;
}

export interface CashBill {
  id: string;
  /** The supplier's QuickBooks id (to open their page). */
  vendorId: string;
  appRef: string | null;
  supplier: string;
  description: string;
  due: string | null;
  left: number;
}

export interface CashOrder {
  id: string;
  number: string;
  supplier: string;
  what: string;
  neededBy: string;
  left: number;
  status: "planned" | "ordered";
}

export interface CashflowInputs {
  /** Today in Ghana, YYYY-MM-DD. */
  today: string;
  money: MoneyNow | null;
  /** The company's entries logged since the money was typed, and the bank's payments not completed yet. */
  since: { out: number; in: number; count: number; pending: number };
  /** The paydays so far, what this week has paid already, and the weekly figure typed (null: the average). */
  wages: { weeks: WageWeek[]; thisWeek: number; typed: number | null };
  bills: CashBill[];
  orders: CashOrder[];
  plans: CashPlan[];
}

export interface CashItem {
  key: string;
  /** The day it's counted on (today, for what was due before). */
  date: string;
  kind: "wages" | "bill" | "order" | "plan";
  direction: "in" | "out";
  amount: number;
  what: string;
  /** BILL-0003, PO-0004. */
  ref: string | null;
  /** The bill's, the order's or the plan's id. */
  id: string | null;
  /** When it was due, when that's before today (it's counted today). */
  late: string | null;
  /** A bill with no due date (counted today). */
  noDate: boolean;
  /** The money after it (null: the money now isn't typed yet). */
  after: number | null;
}

export interface CashWeek {
  /** Monday and Sunday. */
  start: string;
  end: string;
  items: CashItem[];
  out: number;
  in: number;
  /** The money at the end of the week (null: not typed yet). */
  close: number | null;
}

export interface Forecast {
  /** The money now (null: never typed). */
  now: number | null;
  weeks: CashWeek[];
  /** The least it gets to, and when (the money now when nothing goes out). */
  lowest: { amount: number; date: string } | null;
  /** The first day it goes below nothing, and how far. */
  short: { date: string; amount: number } | null;
  /** The weekly wages counted: the figure typed, else the average; and the weeks behind the average. */
  wages: { weekly: number | null; typed: boolean; average: number | null; used: WageWeek[] };
  /** In and out over the weeks shown. */
  totals: { out: number; in: number };
  /** After the weeks shown: the bills, orders and plans still to come. */
  later: { out: number; in: number; count: number };
}

const round = (n: number) => Math.round(n * 100) / 100;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
/** The Monday of a day's week. */
export const mondayOf = (day: string) => addDays(day, -((weekday(day) + 6) % 7));
/** A pay week's payday (its Saturday). */
export const paydayOf = (monday: string) => addDays(monday, (PAYDAY + 6) % 7);

/** The average of the last paydays before this week (the weeks that paid something), and those weeks. */
export function wageAverage(weeks: readonly WageWeek[], thisWeek: string): { average: number | null; used: WageWeek[] } {
  const used = weeks
    .filter((w) => w.week < thisWeek && w.paid > 0)
    .sort((a, b) => b.week.localeCompare(a.week))
    .slice(0, WAGE_WEEKS);
  return { average: used.length ? round(used.reduce((n, w) => n + w.paid, 0) / used.length) : null, used };
}

/** The money now: as typed, less what went out since, plus what came in. */
export function moneyNow(input: Pick<CashflowInputs, "money" | "since">): number | null {
  if (!input.money) return null;
  return round(input.money.amount - input.since.out - input.since.pending + input.since.in);
}

/** The days a plan falls on from `from` to `to` (a monthly one on the same date, or the month's last day). */
export function planDays(plan: Pick<CashPlan, "date" | "repeat" | "until">, from: string, to: string): string[] {
  const last = plan.until && plan.until < to ? plan.until : to;
  if (plan.repeat === "once") return plan.date >= from && plan.date <= last ? [plan.date] : [];
  const out: string[] = [];
  if (plan.repeat === "week") {
    let day = plan.date;
    if (day < from) day = addDays(day, Math.ceil((Date.parse(from) - Date.parse(day)) / (7 * 86_400_000)) * 7);
    for (; day <= last; day = addDays(day, 7)) out.push(day);
    return out;
  }
  const [y, m, d] = plan.date.split("-").map(Number);
  for (let i = 0; i < 400; i++) {
    const month = new Date(Date.UTC(y, m - 1 + i, 1));
    const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    const day = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(d, days))).toISOString().slice(0, 10);
    if (day > last) break;
    if (day >= from) out.push(day);
  }
  return out;
}

/** Everything coming in the weeks shown (this week first), each on its day, with the money after it. */
export function forecast(input: CashflowInputs, weeks: number = WEEKS): Forecast {
  const n = Math.max(1, Math.min(MAX_WEEKS, Math.round(weeks)));
  const today = input.today;
  const start = mondayOf(today);
  const end = addDays(start, n * 7 - 1);
  const { average, used } = wageAverage(input.wages.weeks, start);
  const weekly = input.wages.typed ?? average;
  const items: Omit<CashItem, "after">[] = [];
  const later = { out: 0, in: 0, count: 0 };
  const due = (day: string | null) => (!day || day < today ? today : day);
  const place = (item: Omit<CashItem, "after">) => {
    if (!(item.amount > 0)) return;
    if (item.date > end) {
      later[item.direction] = round(later[item.direction] + item.amount);
      later.count++;
      return;
    }
    items.push(item);
  };

  // The wages each Saturday; this week's less what it has paid already (and none once its Saturday has gone).
  if (weekly !== null && weekly > 0) {
    for (let w = 0; w < n; w++) {
      const monday = addDays(start, w * 7);
      const payday = paydayOf(monday);
      if (payday < today) continue;
      const amount = round(w === 0 ? Math.max(0, weekly - input.wages.thisWeek) : weekly);
      place({ key: `wages-${monday}`, date: payday, kind: "wages", direction: "out", amount, what: "Wages", ref: null, id: null, late: null, noDate: false });
    }
  }
  for (const b of input.bills) {
    place({
      key: `bill-${b.id}`,
      date: due(b.due),
      kind: "bill",
      direction: "out",
      amount: b.left,
      what: [b.supplier, b.description].filter(Boolean).join(": "),
      ref: b.appRef,
      id: b.id,
      late: b.due && b.due < today ? b.due : null,
      noDate: !b.due,
    });
  }
  for (const o of input.orders) {
    place({
      key: `order-${o.id}`,
      date: due(o.neededBy),
      kind: "order",
      direction: "out",
      amount: o.left,
      what: [o.supplier, o.what].filter(Boolean).join(": "),
      ref: o.number,
      id: o.id,
      late: o.neededBy < today ? o.neededBy : null,
      noDate: false,
    });
  }
  // A plan that repeats counts in the weeks shown; one on a day after them is said apart.
  for (const p of input.plans) {
    for (const day of planDays(p, today, p.repeat === "once" ? addDays(end, 3660) : end)) {
      place({ key: `plan-${p.id}-${day}`, date: day, kind: "plan", direction: p.direction, amount: p.amount, what: p.what, ref: null, id: p.id, late: null, noDate: false });
    }
  }

  // Day by day: what goes out first, then what comes in (so the lowest is never missed inside a day).
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.direction === b.direction ? 0 : a.direction === "out" ? -1 : 1) || b.amount - a.amount);
  const now = moneyNow(input);
  let money = now;
  let lowest = now === null ? null : { amount: now, date: today };
  let short: Forecast["short"] = now !== null && now < 0 ? { date: today, amount: now } : null;
  const counted: CashItem[] = items.map((item) => {
    if (money === null) return { ...item, after: null };
    money = round(money + (item.direction === "in" ? item.amount : -item.amount));
    if (lowest && money < lowest.amount) lowest = { amount: money, date: item.date };
    if (!short && money < 0) short = { date: item.date, amount: money };
    return { ...item, after: money };
  });

  const list: CashWeek[] = [];
  let close = now;
  for (let w = 0; w < n; w++) {
    const monday = addDays(start, w * 7);
    const sunday = addDays(monday, 6);
    const mine = counted.filter((i) => i.date >= monday && i.date <= sunday);
    if (close !== null && mine.length) close = mine[mine.length - 1].after;
    list.push({
      start: monday,
      end: sunday,
      items: mine,
      out: round(mine.filter((i) => i.direction === "out").reduce((s, i) => s + i.amount, 0)),
      in: round(mine.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0)),
      close,
    });
  }
  return {
    now,
    weeks: list,
    lowest,
    short,
    wages: { weekly, typed: input.wages.typed !== null, average, used },
    totals: {
      out: round(counted.filter((i) => i.direction === "out").reduce((s, i) => s + i.amount, 0)),
      in: round(counted.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0)),
    },
    later,
  };
}
