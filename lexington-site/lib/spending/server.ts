import "server-only";

import { listExpenses } from "@/lib/expenses/server";
import { FLOORS } from "@/lib/expenses/shared";
import { areasWith } from "@/lib/quickbooks/books";
import { cachedBookLists } from "@/lib/quickbooks/booksCache";
import { cachedHistory, historyStatus } from "@/lib/quickbooks/history";
import { loadConnection } from "@/lib/quickbooks/store";
import { cachedVendors } from "@/lib/quickbooks/vendors";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { EXPENSE_PREFIX } from "@/lib/site/ids";
import { ghanaDay } from "@/lib/store/shared";
import { listBills } from "@/lib/suppliers/server";
import { supplierKey } from "@/lib/suppliers/shared";
import { floorName, meantDate, type QboTxn, type SpendEntry, type SpendingData } from "./shared";

// The spending (lib/spending/shared.ts says what and why): QuickBooks' transactions as read (lib/quickbooks/history.ts),
// and the site app's own that aren't in QuickBooks yet: its company expenses (Site and Event) never sent (before the
// feed's start date, or waiting), and its suppliers' bills not in yet. An app entry already in QuickBooks is left to
// QuickBooks' copy, so nothing counts twice. Money in, and House and Niko entries, aren't the company's spending.

/** A day typed long after the date it carries is a day and month swapped (8/2 typed as August the 2nd). */
const ODD_DAYS = 20;
const daysBetween = (a: string, b: string) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

function fromQbo(t: QboTxn, floors: readonly string[], billNames: ReadonlyMap<string, string>): SpendEntry {
  const kind = t.type === "BillPayment" ? "payment" : t.type === "Bill" ? "bill" : t.total < 0 ? "credit" : "expense";
  const what = t.lines.map((l) => l.description).find(Boolean) ?? t.memo.replace(/^((?:EXP|IN|BILL)-\d{4,}) from the site app( · )?/, "");
  return {
    key: `qbo:${t.type}:${t.id}`,
    source: "qbo",
    kind,
    date: t.date,
    supplier: t.vendorName ?? t.payee ?? "",
    vendorId: t.vendorId,
    description: what.slice(0, 160),
    amount: t.total,
    floor: floorName(t.location?.name, floors),
    lines: t.lines.map((l) => ({ amount: l.amount, cls: l.className })),
    ref: t.appRef ?? (t.doc || null),
    ...(t.created && t.date && daysBetween(t.date, t.created) > ODD_DAYS ? { odd: true, typed: t.created, meant: meantDate(t.date, t.created) } : {}),
    ...(t.type === "BillPayment" ? { pays: (t.paysBills ?? []).map((id) => billNames.get(id) ?? "a bill").join(", ") || "a bill" } : {}),
  };
}

/** Everything spent, QuickBooks' and the app's own not there yet, newest first. */
export async function spendingData(): Promise<SpendingData> {
  const [txns, status, expenses, links, bills, vendors, books, conn] = await Promise.all([
    cachedHistory(),
    historyStatus(),
    listExpenses(),
    // Which app entries went into QuickBooks, and as what.
    getBuyersClient().fetch<{ id: string; txn: string }[]>(
      `*[_type == "siteExpense" && string::startsWith(_id, $prefix) && defined(qbo.txnId)]{ "id": _id, "txn": qbo.txnType + ":" + qbo.txnId }`,
      { prefix: EXPENSE_PREFIX }
    ),
    listBills(),
    cachedVendors(),
    cachedBookLists().catch(() => ({ classes: [], locations: [], fetchedAt: null })),
    loadConnection().catch(() => null),
  ]);
  const floors = areasWith(FLOORS, books.locations);
  // A bill by its app number (BILL-0003), else the supplier's invoice number.
  const billNames = new Map(txns.filter((t) => t.type === "Bill").map((t) => [t.id, t.appRef ?? (t.doc || "a bill")]));
  const entries: SpendEntry[] = txns.map((t) => fromQbo(t, floors, billNames));
  const appBillRefs = new Map(bills.map((b) => [b.id, b.appRef ?? "a bill"]));
  const inBooks = new Set(txns.map((t) => `${t.type}:${t.id}`));
  const sentAs = new Map(links.map((l) => [l.id, l.txn]));
  // A name typed in the app, as QuickBooks' supplier when it's one of theirs.
  const vendorByKey = new Map(vendors.vendors.flatMap((v) => [[supplierKey(v.name), v] as const, ...(v.company ? [[supplierKey(v.company), v] as const] : [])]));
  const vendorOf = (name: string) => (name.trim() ? (vendorByKey.get(supplierKey(name)) ?? null) : null);

  for (const x of expenses) {
    if (x.kind !== "expense" || (x.forWho !== "Site" && x.forWho !== "Event")) continue;
    const sent = sentAs.get(x.id);
    if (sent && inBooks.has(sent)) continue;
    const v = vendorOf(x.supplier);
    entries.push({
      key: `app:${x.id}`,
      source: "app",
      // A payment of a supplier's bill pays a cost the bill already holds.
      kind: x.billId ? "payment" : "expense",
      date: x.date,
      supplier: v?.name ?? x.supplier.trim(),
      vendorId: v?.id ?? null,
      description: (x.description || x.material || "").slice(0, 160),
      amount: x.amount,
      floor: x.floor && x.floor !== "Whole building" ? x.floor : null,
      lines: x.billId ? [] : [{ amount: x.amount, cls: x.costClass?.name ?? null }],
      ref: x.ref ?? null,
      ...(x.billId ? { pays: appBillRefs.get(x.billId) ?? "a bill" } : {}),
    });
  }
  for (const b of bills) {
    if (b.qboTxnId && inBooks.has(`Bill:${b.qboTxnId}`)) continue;
    entries.push({
      key: `bill:${b.id}`,
      source: "app",
      kind: "bill",
      date: b.date,
      supplier: b.supplier,
      vendorId: b.vendorId,
      description: b.description,
      amount: b.amount,
      floor: b.floor && b.floor !== "Whole building" ? b.floor : null,
      lines: [{ amount: b.amount, cls: b.costClass?.name ?? null }],
      ref: b.appRef,
    });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  return { entries, fetchedAt: status.fetchedAt, error: status.error, connected: conn?.status === "connected", today: ghanaDay() };
}

/** One supplier's whole record: everything with them in QuickBooks, and the app's own not there yet. */
export async function supplierHistory(vendorId: string): Promise<SpendEntry[]> {
  const data = await spendingData();
  return data.entries.filter((e) => e.vendorId === vendorId);
}
