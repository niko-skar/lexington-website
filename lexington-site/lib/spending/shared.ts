import { areaKey } from "@/lib/quickbooks/books";

// Spending (Niko, 3 Nov 2026: "is it worth importing every transaction inside quickbooks and attributing them to the
// supplier so I can easily see the entire record I have with one supplier and also pull easy information like total
// spent, total spent per floor, etc.? total spent per class so cement, concrete, steel, etc.?" ... "yes do the
// quickbooks import"). QuickBooks' own transactions, read into the website (lib/quickbooks/history.ts, read only),
// together with the site app's entries that aren't in QuickBooks yet, nothing counted twice. Shared by the server
// and the phone: the phone adds up whatever period is picked.

/** One transaction as QuickBooks has it (what the spending needs of it). */
export interface QboTxn {
  type: "Purchase" | "Bill" | "VendorCredit" | "BillPayment";
  id: string;
  /** YYYY-MM-DD, as typed in QuickBooks. */
  date: string;
  /** When it was typed into QuickBooks (YYYY-MM-DD): a date long after it is a day and month swapped. */
  created: string;
  doc: string;
  /** The supplier (a QuickBooks vendor), when it has one. */
  vendorId: string | null;
  vendorName: string | null;
  /** Paid to someone who isn't a vendor (a customer or an employee in the books). */
  payee: string | null;
  /** Costs positive; a refund or a supplier's credit negative; a bill payment what it paid. */
  total: number;
  /** The account it was paid from (an expense) or with (a bill payment). */
  paidFrom: string | null;
  location: { id: string; name: string } | null;
  memo: string;
  /** The cost lines: what each was, and its class (cost type). None on a bill payment. */
  lines: { amount: number; account: string | null; classId: string | null; className: string | null; description: string }[];
  /** "EXP-0123" (or BILL-, IN-) when the site app made it. */
  appRef: string | null;
  /** A bill payment: the bills it paid (their ids in QuickBooks). */
  paysBills?: string[];
}

/** Costs, the money that paid bills, and credits: what an entry is. */
export type SpendKind = "expense" | "bill" | "credit" | "payment";

/** An entry of spending: from QuickBooks, or the site app's own while it isn't there yet. */
export interface SpendEntry {
  /** "qbo:Purchase:123", "app:expense-live-…", "bill:bill-live-…". */
  key: string;
  source: "qbo" | "app";
  kind: SpendKind;
  date: string;
  /** Who: the supplier (QuickBooks' name), else the name typed, else "". */
  supplier: string;
  vendorId: string | null;
  description: string;
  /** Positive for a cost or a payment; negative for a credit. */
  amount: number;
  /** The floor or stage in the app's words ("1st floor", "Foundations"), or null. */
  floor: string | null;
  /** The cost lines with their class name ("Materials:Cement Bags"), or null with none. A payment has none. */
  lines: { amount: number; cls: string | null }[];
  ref: string | null;
  /** Dated long after it was typed (QuickBooks only): probably the day and month swapped. */
  odd?: boolean;
  /** An odd one: the day it was typed into QuickBooks, and the date it was meant to have (null: for the office to say). */
  typed?: string;
  meant?: string | null;
  /** A payment: the bill(s) it paid ("BILL-0003", their invoice number, or "a bill"). */
  pays?: string;
}

/** A whole date that exists ("2026-02-11"; not "2026-02-30"). */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The day and month the other way round ("2026-11-02" -> "2026-02-11"); null when the day can't be a month. */
export function swapDayMonth(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || Number(m[3]) > 12) return null;
  const swapped = `${m[1]}-${m[3]}-${m[2]}`;
  return isDay(swapped) ? swapped : null;
}

/**
 * The date one dated long after it was typed was meant to have (Niko, 6 Nov 2026: "can you bulk reverse the dates on
 * qbo for me?"): its day and month swapped (8/2 typed for 8 February, read as 2 August), when that lands on or before
 * the day it was typed and within half a year of it (his sheet's February went in from an export in June). Else null.
 */
export function meantDate(date: string, typed: string): string | null {
  const swapped = swapDayMonth(date);
  if (!swapped || !isDay(typed)) return null;
  const before = (Date.parse(`${typed}T00:00:00Z`) - Date.parse(`${swapped}T00:00:00Z`)) / 86_400_000;
  return before >= -1 && before <= 183 ? swapped : null;
}

export interface SpendingData {
  entries: SpendEntry[];
  /** When QuickBooks was last read (null: never yet), and how that went. */
  fetchedAt: string | null;
  error: string | null;
  connected: boolean;
  today: string;
}

/* ---------- adding up ---------- */

export const NO_SUPPLIER = "No supplier";
export const NO_CLASS = "No cost type";
export const NO_FLOOR = "Whole building / not said";

/** A cost (counts in what was spent): expenses and bills, less credits; bill payments only pay bills. */
export const isCost = (e: Pick<SpendEntry, "kind">) => e.kind !== "payment";

export type Row = { name: string; amount: number; count: number };

function rowsOf(map: Map<string, Row>): Row[] {
  return [...map.values()].filter((r) => Math.abs(r.amount) >= 0.005).sort((a, b) => b.amount - a.amount);
}
const add = (map: Map<string, Row>, name: string, amount: number) => {
  const row = map.get(name) ?? { name, amount: 0, count: 0 };
  row.amount = Math.round((row.amount + amount) * 100) / 100;
  row.count++;
  map.set(name, row);
};

/** What was spent on each cost type (by the classes on the lines). */
export function byClass(entries: readonly SpendEntry[]): Row[] {
  const map = new Map<string, Row>();
  for (const e of entries) if (isCost(e)) for (const l of e.lines) add(map, l.cls || NO_CLASS, l.amount);
  return rowsOf(map);
}
/** The same, by the class's top level ("Materials", "Labour"). */
export function byClassGroup(entries: readonly SpendEntry[]): Row[] {
  const map = new Map<string, Row>();
  for (const e of entries) if (isCost(e)) for (const l of e.lines) add(map, l.cls ? l.cls.split(":")[0] : NO_CLASS, l.amount);
  return rowsOf(map);
}
export function byFloor(entries: readonly SpendEntry[]): Row[] {
  const map = new Map<string, Row>();
  for (const e of entries) if (isCost(e)) add(map, e.floor || NO_FLOOR, e.amount);
  return rowsOf(map);
}
export function bySupplier(entries: readonly SpendEntry[]): Row[] {
  const map = new Map<string, Row>();
  for (const e of entries) if (isCost(e)) add(map, e.supplier || NO_SUPPLIER, e.amount);
  return rowsOf(map);
}
/** Month by month, oldest first (the months with nothing recorded included, so a gap shows). */
export function byMonth(entries: readonly SpendEntry[]): Row[] {
  const map = new Map<string, Row>();
  for (const e of entries) if (isCost(e)) add(map, e.date.slice(0, 7), e.amount);
  const months = [...map.keys()].sort();
  if (!months.length) return [];
  const out: Row[] = [];
  for (let m = months[0]; m <= months[months.length - 1]; m = nextMonth(m)) out.push(map.get(m) ?? { name: m, amount: 0, count: 0 });
  return out;
}
export const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};
export const total = (entries: readonly SpendEntry[]) => Math.round(entries.filter(isCost).reduce((n, e) => n + e.amount, 0) * 100) / 100;

/** Which entries a row stands for (its drill-down). */
export function entriesOf(entries: readonly SpendEntry[], by: "class" | "group" | "floor" | "supplier" | "month", name: string): SpendEntry[] {
  return entries
    .filter((e) => {
      if (!isCost(e)) return false;
      if (by === "class") return e.lines.some((l) => (l.cls || NO_CLASS) === name);
      if (by === "group") return e.lines.some((l) => (l.cls ? l.cls.split(":")[0] : NO_CLASS) === name);
      if (by === "floor") return (e.floor || NO_FLOOR) === name;
      if (by === "supplier") return (e.supplier || NO_SUPPLIER) === name;
      return e.date.startsWith(name);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** The things to put right in the books: no supplier, no cost type, odd dates, and months with nothing in them. */
export function checksOf(entries: readonly SpendEntry[]): { noSupplier: SpendEntry[]; noClass: SpendEntry[]; odd: SpendEntry[]; emptyMonths: string[] } {
  const costs = entries.filter(isCost);
  return {
    noSupplier: costs.filter((e) => !e.supplier),
    noClass: costs.filter((e) => e.lines.some((l) => !l.cls)),
    odd: costs.filter((e) => e.odd),
    emptyMonths: byMonth(entries)
      .filter((r) => r.count === 0)
      .map((r) => r.name),
  };
}

/* ---------- periods ---------- */

// Everything first: it's what the page opens on, so its chip is the one in sight on a phone.
export const PERIODS = ["all", "year", "month", "lastMonth", "twelve"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_NAMES: Record<Period, string> = { month: "This month", lastMonth: "Last month", year: "This year", twelve: "Last 12 months", all: "Everything" };

/** The first and last day a period covers (YYYY-MM-DD), from today. */
export function periodDays(period: Period, today: string): { from: string; to: string } {
  const month = today.slice(0, 7);
  if (period === "month") return { from: `${month}-01`, to: today };
  if (period === "lastMonth") {
    const [y, m] = month.split("-").map(Number);
    const last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    return { from: `${last}-01`, to: `${last}-31` };
  }
  if (period === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (period === "twelve") return { from: `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-01`, to: today };
  return { from: "0000-01-01", to: "9999-12-31" };
}
export const inPeriod = (e: Pick<SpendEntry, "date">, days: { from: string; to: string }) => e.date >= days.from && e.date <= days.to;

/** A QuickBooks location in the app's words: "First Floor" is the app's "1st floor". */
export function floorName(name: string | null | undefined, floors: readonly string[]): string | null {
  if (!name) return null;
  const leaf = name.split(":").pop() ?? name;
  return floors.find((f) => areaKey(f) === areaKey(leaf)) ?? leaf;
}
