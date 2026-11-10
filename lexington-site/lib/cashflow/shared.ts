// The cash flow (Niko, 5 Nov 2026: "a cashflow tab where I can estimate based on our current balance and what needs
// to be bought and when" ... "it should estimate the weeks payroll into the cashflow"). It starts from the money now:
// the bank and the cash on hand as last typed, then every entry logged since, out or in (and the bank's payments still
// waiting to be completed). Then week by week what's coming: the wages each Saturday (the last paydays' average, or the
// weekly figure typed), the suppliers' bills on their due dates, the purchase orders on the day they're needed, and
// the money in or out typed as expected. Only the company's money counts (Site and Event entries, as in the books):
// the House and Niko's own never do. Kept apart from the server so it can be checked on its own.
// The money coming in (Niko, 5 Nov 2026: "most of my money comes from leo, so i need to be able to estimate future money
// coming, and also future buyers"): Leo's each week (his last weeks' average on the day he sends most, or a figure
// typed), each buyer's payments as planned (in dollars, until what they owe is paid), and new buyers expected; dollars
// count in cedis at the last buyer payment's rate, or one typed.

/** Payday: Saturday (the roll call pays the week, Monday to Saturday, that day). */
export const PAYDAY = 6;
/** The wages estimate: the average of the last few paydays. */
export const WAGE_WEEKS = 4;
/** Leo's estimate: the average of his last few weeks (the weeks he sent nothing count as nothing). */
export const LEO_WEEKS = 4;
export const CURRENCIES = ["GHS", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];
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
  /** The amount's money: cedis, or dollars (a buyer's, a new sale's). */
  currency: Currency;
  /** A buyer's payments: counted only until what they owe is paid. */
  buyerId: string | null;
  createdAt: string;
  createdBy: string;
}

/** A buyer still paying for their home (lib/buyers): what they owe, in dollars. */
export interface CashBuyer {
  id: string;
  name: string;
  balanceUSD: number;
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
  /** When it's to be paid, when that's not the day it comes. */
  payBy?: string | null;
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
  /**
   * Leo's money in by week (from the first week there's any), what came this week, the weekly figure typed (null:
   * the average) and the day he sends most (0 Sunday ... 6 Saturday).
   */
  leo: { weeks: WageWeek[]; thisWeek: number; typed: number | null; day: number };
  bills: CashBill[];
  orders: CashOrder[];
  plans: CashPlan[];
  buyers: CashBuyer[];
  /** GH₵ per US$: the one typed, and the last buyer payment's. */
  rate: { typed: number | null; last: number | null };
}

export interface CashItem {
  key: string;
  /** The day it's counted on (today, for what was due before). */
  date: string;
  kind: "wages" | "bill" | "order" | "plan" | "leo";
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
  /** The same if no money comes in: the money now less everything that's gone out by then. */
  closeNoIn: number | null;
}

export interface Forecast {
  /** The money now (null: never typed). */
  now: number | null;
  weeks: CashWeek[];
  /** The least it gets to, and when (the money now when nothing goes out). */
  lowest: { amount: number; date: string } | null;
  /** The first day it goes below nothing, and how far. */
  short: { date: string; amount: number } | null;
  /**
   * If no money comes in (Niko, 10 Nov 2026: "my positions if no cash comes in, in other words my entire exposure"):
   * Leo's, the buyers' and every other money in left out, only what goes out counted. The first day it's below nothing,
   * and the money at the end of the weeks shown (below nothing: that much to find).
   */
  noIn: { short: { date: string; amount: number } | null; end: number | null };
  /** The weekly wages counted: the figure typed, else the average; and the weeks behind the average. */
  wages: { weekly: number | null; typed: boolean; average: number | null; used: WageWeek[] };
  /** Leo's weekly money counted, the same way, and the day it's counted on. */
  leo: { weekly: number | null; typed: boolean; average: number | null; used: WageWeek[]; day: number };
  /** The dollar rate used (null: none yet, so plans in dollars can't count). */
  rate: number | null;
  /** Plans in dollars left out for want of a rate. */
  unconverted: number;
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

/** Leo's average over his last weeks before this one: the weeks he sent nothing count, those before his first don't. */
export function leoAverage(weeks: readonly WageWeek[], thisWeek: string): { average: number | null; used: WageWeek[] } {
  const first = weeks.filter((w) => w.paid > 0).map((w) => w.week).sort()[0];
  if (!first) return { average: null, used: [] };
  const used: WageWeek[] = [];
  for (let w = addDays(thisWeek, -7); w >= first && used.length < LEO_WEEKS; w = addDays(w, -7)) {
    used.push({ week: w, paid: round(weeks.filter((x) => x.week === w).reduce((s, x) => s + x.paid, 0)) });
  }
  return { average: used.length ? round(used.reduce((s, w) => s + w.paid, 0) / used.length) : null, used };
}

/** The day a week's money from Leo is counted on: his usual weekday that week. */
export const leoDayOf = (monday: string, day: number) => addDays(monday, (day + 6) % 7);

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
  const leoAvg = leoAverage(input.leo.weeks, start);
  const leoWeekly = input.leo.typed ?? leoAvg.average;
  const rate = input.rate.typed ?? input.rate.last;
  let unconverted = 0;
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
  // An order's money goes out the day it's to be paid (when it comes, unless said).
  for (const o of input.orders) {
    const pay = o.payBy ?? o.neededBy;
    place({
      key: `order-${o.id}`,
      date: due(pay),
      kind: "order",
      direction: "out",
      amount: o.left,
      what: [o.supplier, o.what].filter(Boolean).join(": "),
      ref: o.number,
      id: o.id,
      late: pay < today ? pay : null,
      noDate: false,
    });
  }
  // Leo's each week on his usual day; this week's less what came already (today, when his day has gone).
  if (leoWeekly !== null && leoWeekly > 0) {
    for (let w = 0; w < n; w++) {
      const monday = addDays(start, w * 7);
      const day = leoDayOf(monday, input.leo.day);
      const amount = round(w === 0 ? Math.max(0, leoWeekly - input.leo.thisWeek) : leoWeekly);
      place({ key: `leo-${monday}`, date: day < today ? today : day, kind: "leo", direction: "in", amount, what: "Leo", ref: null, id: null, late: null, noDate: false });
    }
  }
  // A plan that repeats counts in the weeks shown; one on a day after them is said apart. Dollars count in cedis.
  for (const p of input.plans) {
    const dollars = p.currency === "USD";
    if (dollars && !rate) {
      unconverted++;
      continue;
    }
    const cedis = (x: number) => (dollars ? round(x * (rate ?? 0)) : x);
    const buyer = p.buyerId ? input.buyers.find((b) => b.id === p.buyerId) : null;
    // A buyer who owes nothing any more (or isn't there) pays nothing.
    if (p.buyerId && !buyer) continue;
    if (buyer && dollars) {
      // Their payments until what they owe is paid (the last one only what's left); after the weeks shown, the rest once.
      let owed = buyer.balanceUSD;
      for (const day of planDays(p, today, addDays(end, 3660))) {
        if (!(owed > 0.005)) break;
        if (day > end) {
          place({ key: `plan-${p.id}-later`, date: day, kind: "plan", direction: p.direction, amount: cedis(owed), what: p.what, ref: null, id: p.id, late: null, noDate: false });
          break;
        }
        const usd = Math.min(p.amount, owed);
        owed = round(owed - usd);
        place({ key: `plan-${p.id}-${day}`, date: day, kind: "plan", direction: p.direction, amount: cedis(usd), what: p.what, ref: null, id: p.id, late: null, noDate: false });
      }
      continue;
    }
    for (const day of planDays(p, today, p.repeat === "once" ? addDays(end, 3660) : end)) {
      place({ key: `plan-${p.id}-${day}`, date: day, kind: "plan", direction: p.direction, amount: cedis(p.amount), what: p.what, ref: null, id: p.id, late: null, noDate: false });
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
  // If no money comes in: the same days, only what goes out.
  let bare = now;
  let bareShort: Forecast["short"] = now !== null && now < 0 ? { date: today, amount: now } : null;
  for (let w = 0; w < n; w++) {
    const monday = addDays(start, w * 7);
    const sunday = addDays(monday, 6);
    const mine = counted.filter((i) => i.date >= monday && i.date <= sunday);
    if (close !== null && mine.length) close = mine[mine.length - 1].after;
    for (const i of mine) {
      if (bare === null || i.direction !== "out") continue;
      bare = round(bare - i.amount);
      if (!bareShort && bare < 0) bareShort = { date: i.date, amount: bare };
    }
    list.push({
      start: monday,
      end: sunday,
      items: mine,
      out: round(mine.filter((i) => i.direction === "out").reduce((s, i) => s + i.amount, 0)),
      in: round(mine.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0)),
      close,
      closeNoIn: bare,
    });
  }
  return {
    now,
    weeks: list,
    lowest,
    short,
    noIn: { short: bareShort, end: bare },
    wages: { weekly, typed: input.wages.typed !== null, average, used },
    leo: { weekly: leoWeekly, typed: input.leo.typed !== null, average: leoAvg.average, used: leoAvg.used, day: input.leo.day },
    rate,
    unconverted,
    totals: {
      out: round(counted.filter((i) => i.direction === "out").reduce((s, i) => s + i.amount, 0)),
      in: round(counted.filter((i) => i.direction === "in").reduce((s, i) => s + i.amount, 0)),
    },
    later,
  };
}
