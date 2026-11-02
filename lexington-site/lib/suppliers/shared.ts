import type { Expense } from "@/lib/expenses/shared";

// Suppliers and their bills (Niko, 2 Nov 2026: "add a supplier list and allow me to make bills against them that will
// be paid in the future and give me a tile on the home page that shows total outstanding. all payments made to
// suppliers should show up in their supplier page" ... "you can pull the supplier list from quickbooks so it all
// matches"). The suppliers are QuickBooks' own (its vendors). A bill goes into QuickBooks as a Bill, so QuickBooks owes
// the same; a payment that pays a bill (an expense with billId) goes in as its Bill Payment instead of an expense of
// its own, so nothing is counted twice. What's still owed is each bill less what has paid it.

/** A supplier as QuickBooks has it (cached in the website, read again every few minutes). */
export interface QboVendor {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  /** What QuickBooks says is owed to them (its open bills). */
  balance: number;
}

export interface Bill {
  id: string;
  /** The app's own number, BILL-0001. */
  appRef: string | null;
  /** The QuickBooks vendor it's owed to. */
  vendorId: string;
  supplier: string;
  /** YYYY-MM-DD */
  date: string;
  /** When it's to be paid (YYYY-MM-DD), or null. */
  due: string | null;
  amount: number;
  description: string;
  /** Their invoice or bill number, if any. */
  ref: string;
  /** The floor or stage (its QuickBooks location), or null for the whole building. */
  floor: string | null;
  costClass: { id: string; name: string } | null;
  photoUrl: string | null;
  createdAt: string;
  createdBy: string;
  /** In QuickBooks: its bill there, or why not yet. */
  qboTxnId: string | null;
  qboError: string | null;
}

/** A bill with what has paid it. */
export interface BillState extends Bill {
  paid: number;
  left: number;
  /** The expenses that paid it, newest first. */
  payments: Expense[];
  overdue: boolean;
}

export interface SupplierRow {
  vendor: QboVendor;
  /** What the open bills still want. */
  owed: number;
  openBills: number;
  /** Paid to them in all (every expense to them, bills or not). */
  paidTotal: number;
  lastPaid: string | null;
  nextDue: string | null;
  overdue: number;
}

export interface SuppliersData {
  suppliers: SupplierRow[];
  bills: BillState[];
  /** Every bill's still owed, together. */
  owed: number;
  /** When the QuickBooks list was read (null: never, QuickBooks not connected yet). */
  fetchedAt: string | null;
  today: string;
}

/** The suppliers page: the figures, and what the bill form offers (the floors and stages, the cost types). */
export interface SuppliersPage extends SuppliersData {
  areas: string[];
  classes: Array<{ id: string; name: string }>;
  /** QuickBooks connected: suppliers can be added from here. */
  connected: boolean;
  /** Every payment to a supplier (the expenses with a supplier, or a bill), for the suppliers' pages. */
  payments: Expense[];
}

/** A bill still to pay, for the expense form's "Pays a bill?". */
export type OpenBill = Pick<BillState, "id" | "appRef" | "supplier" | "description" | "amount" | "left" | "due">;

/** The bills still to pay (what the expense form offers), from the bills and the expenses. */
export function openBillsOf(bills: readonly Bill[], expenses: readonly Expense[], today: string): OpenBill[] {
  return suppliersFrom([], bills, expenses, today)
    .bills.filter((b) => b.left > 0)
    .map((b) => ({ id: b.id, appRef: b.appRef, supplier: b.supplier, description: b.description, amount: b.amount, left: b.left, due: b.due }));
}

/** A name as compared: no case, no extra spaces, no "(supplier)" QuickBooks adds when the name is taken. */
export const supplierKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\(supplier\)/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Does this expense go to this supplier (by its name, the way the expenses carry it)? */
export const paidTo = (x: Pick<Expense, "supplier">, vendor: Pick<QboVendor, "name" | "company">) => {
  const k = supplierKey(x.supplier ?? "");
  return !!k && (k === supplierKey(vendor.name) || (!!vendor.company && k === supplierKey(vendor.company)));
};

const round = (n: number) => Math.round(n * 100) / 100;

/** The bills with what has paid them (the expenses that name them), and each supplier's figures. */
export function suppliersFrom(vendors: readonly QboVendor[], bills: readonly Bill[], expenses: readonly Expense[], today: string): Omit<SuppliersData, "fetchedAt"> {
  const spent = expenses.filter((x) => x.kind === "expense");
  const states: BillState[] = bills.map((b) => {
    const payments = spent.filter((x) => x.billId === b.id).sort((a, c) => c.date.localeCompare(a.date));
    const paid = round(payments.reduce((n, x) => n + x.amount, 0));
    const left = round(Math.max(0, b.amount - paid));
    return { ...b, paid, left, payments, overdue: left > 0 && !!b.due && b.due < today };
  });
  states.sort((a, c) => (a.left > 0 ? 0 : 1) - (c.left > 0 ? 0 : 1) || (a.due ?? "9999").localeCompare(c.due ?? "9999") || c.date.localeCompare(a.date));
  const suppliers: SupplierRow[] = vendors.map((vendor) => {
    const mine = states.filter((b) => b.vendorId === vendor.id);
    const open = mine.filter((b) => b.left > 0);
    const payments = spent.filter((x) => paidTo(x, vendor) || mine.some((b) => b.id === x.billId));
    return {
      vendor,
      owed: round(open.reduce((n, b) => n + b.left, 0)),
      openBills: open.length,
      paidTotal: round(payments.reduce((n, x) => n + x.amount, 0)),
      lastPaid: payments.map((x) => x.date).sort().pop() ?? null,
      nextDue: open.map((b) => b.due).filter((d): d is string => !!d).sort()[0] ?? null,
      overdue: open.filter((b) => b.overdue).length,
    };
  });
  // Owed first, the most first; then the ones paid lately; then by name.
  suppliers.sort((a, c) => c.owed - a.owed || (c.lastPaid ?? "").localeCompare(a.lastPaid ?? "") || a.vendor.name.localeCompare(c.vendor.name));
  return { suppliers, bills: states, owed: round(states.reduce((n, b) => n + b.left, 0)), today };
}

/** The payments to a supplier, newest first: every expense to them by name, and any that paid one of their bills. */
export function paymentsTo(vendor: QboVendor, bills: readonly BillState[], expenses: readonly Expense[]): Expense[] {
  const ids = new Set(bills.filter((b) => b.vendorId === vendor.id).map((b) => b.id));
  return expenses.filter((x) => x.kind === "expense" && (paidTo(x, vendor) || (!!x.billId && ids.has(x.billId)))).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
