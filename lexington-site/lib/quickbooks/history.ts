import "server-only";
import { createHash } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { QBO_HISTORY_ID, QBO_TXN_MONTH_PREFIX } from "@/lib/site/ids";
import type { QboTxn } from "@/lib/spending/shared";
import type { BookNamed } from "./books";
import { cachedBookLists } from "./booksCache";
import { qboApi } from "./client";
import { loadConnection } from "./store";

// Every QuickBooks transaction the spending needs (Niko, 3 Nov 2026: "yes do the quickbooks import"): expenses
// (Purchase, with refunds as Credit), bills, suppliers' credits and bill payments, READ from the books and kept in
// the website by month (one document a month, so a change rewrites only its month). Nothing is ever written to
// QuickBooks from here. Read again every few hours by the 15-minute QuickBooks run, or at once from the Spending page.

export const HISTORY_STALE_MS = 3 * 3600_000;
const TYPES: QboTxn["type"][] = ["Purchase", "Bill", "VendorCredit", "BillPayment"];

type Ref = { value?: string; name?: string; type?: string } | undefined;
type RawLine = {
  Amount?: number;
  Description?: string;
  DetailType?: string;
  AccountBasedExpenseLineDetail?: { AccountRef?: Ref; ClassRef?: Ref };
  ItemBasedExpenseLineDetail?: { ItemRef?: Ref; ClassRef?: Ref };
};
type Raw = {
  Id: string;
  TxnDate?: string;
  DocNumber?: string;
  TotalAmt?: number;
  Credit?: boolean;
  PrivateNote?: string;
  EntityRef?: Ref;
  VendorRef?: Ref;
  AccountRef?: Ref;
  DepartmentRef?: Ref;
  CheckPayment?: { BankAccountRef?: Ref };
  CreditCardPayment?: { CCAccountRef?: Ref };
  MetaData?: { CreateTime?: string; LastUpdatedTime?: string };
  Line?: RawLine[];
};

const APP_REF = /^((?:EXP|IN|BILL)-\d{4,}) from the site app/;
const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** One transaction as the spending keeps it (class and location names from the books' own lists). */
export function toTxn(type: QboTxn["type"], raw: Raw, classes: ReadonlyMap<string, string>, locations: ReadonlyMap<string, string>): QboTxn {
  // A refund on an expense, and a supplier's credit, come off what was spent.
  const sign = type === "VendorCredit" || (type === "Purchase" && raw.Credit === true) ? -1 : 1;
  const who = type === "Purchase" ? raw.EntityRef : raw.VendorRef;
  const isVendor = type !== "Purchase" || who?.type === "Vendor";
  const paidFrom = type === "BillPayment" ? (raw.CheckPayment?.BankAccountRef?.name ?? raw.CreditCardPayment?.CCAccountRef?.name ?? null) : (raw.AccountRef?.name ?? null);
  const lines =
    type === "BillPayment"
      ? []
      : (raw.Line ?? [])
          .filter((l) => l.DetailType === "AccountBasedExpenseLineDetail" || l.DetailType === "ItemBasedExpenseLineDetail")
          .map((l) => {
            const d = l.AccountBasedExpenseLineDetail ?? l.ItemBasedExpenseLineDetail;
            const cls = d?.ClassRef?.value ?? null;
            const account = l.AccountBasedExpenseLineDetail?.AccountRef?.name ?? l.ItemBasedExpenseLineDetail?.ItemRef?.name ?? null;
            return { amount: sign * money(l.Amount), account, classId: cls, className: cls ? (classes.get(cls) ?? d?.ClassRef?.name ?? null) : null, description: (l.Description ?? "").slice(0, 200) };
          });
  const loc = raw.DepartmentRef?.value ?? null;
  const memo = (raw.PrivateNote ?? "").slice(0, 300);
  return {
    type,
    id: raw.Id,
    date: raw.TxnDate ?? "",
    created: (raw.MetaData?.CreateTime ?? "").slice(0, 10),
    doc: raw.DocNumber ?? "",
    vendorId: isVendor ? (who?.value ?? null) : null,
    vendorName: isVendor ? (who?.name ?? null) : null,
    payee: !isVendor ? (who?.name ?? null) : null,
    total: sign * money(raw.TotalAmt),
    paidFrom,
    location: loc ? { id: loc, name: locations.get(loc) ?? raw.DepartmentRef?.name ?? loc } : null,
    memo,
    lines,
    appRef: APP_REF.exec(memo)?.[1] ?? null,
    ...(type === "BillPayment"
      ? { paysBills: (raw.Line ?? []).flatMap((l) => ((l as { LinkedTxn?: { TxnId?: string; TxnType?: string }[] }).LinkedTxn ?? []).filter((t) => t.TxnType === "Bill" && t.TxnId).map((t) => t.TxnId!)) }
      : {}),
  };
}

/** Everything of one kind in the books, a thousand at a time. */
async function readAll(type: QboTxn["type"]): Promise<Raw[]> {
  const out: Raw[] = [];
  for (let start = 1; start < 100_000; start += 1000) {
    const reply = await qboApi<{ QueryResponse?: Record<string, Raw[] | undefined> }>("query", {
      query: { query: `select * from ${type} startposition ${start} maxresults 1000` },
    });
    const page = reply.QueryResponse?.[type] ?? [];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

export interface HistoryStatus {
  fetchedAt: string | null;
  count: number;
  error: string | null;
}

export async function historyStatus(): Promise<HistoryStatus> {
  const doc = await getBuyersClient().fetch<HistoryStatus | null>(`*[_id == $id][0]{ fetchedAt, count, error }`, { id: QBO_HISTORY_ID });
  return { fetchedAt: doc?.fetchedAt ?? null, count: doc?.count ?? 0, error: doc?.error ?? null };
}

/** Every transaction kept from the books, oldest first. */
export async function cachedHistory(): Promise<QboTxn[]> {
  const months = await getBuyersClient().fetch<{ json: string }[]>(`*[_type == "qboTxnMonth" && string::startsWith(_id, $prefix)] | order(month asc){ json }`, {
    prefix: QBO_TXN_MONTH_PREFIX,
  });
  const out: QboTxn[] = [];
  for (const m of months) {
    try {
      out.push(...(JSON.parse(m.json) as QboTxn[]));
    } catch {
      // A month that can't be read is read again from QuickBooks next time.
    }
  }
  return out;
}

const names = (list: readonly BookNamed[]) => new Map(list.map((x) => [x.id, x.name]));

/**
 * Reads the books again when a few hours old (or now, when forced): month by month, a month only written when it
 * changed, and one no longer in the books removed. Never throws: how it went is kept for the Spending page.
 * "now": straight after the site app changed something in them (lib/spending/fixDates.ts), however recent the last read.
 */
export async function syncHistory(force: boolean | "now" = false): Promise<HistoryStatus> {
  const client = getBuyersClient();
  const before = await historyStatus();
  // Asked for now: at most once a minute (a second tap answers with what was just read).
  if (force !== "now" && before.fetchedAt && !before.error && Date.now() - Date.parse(before.fetchedAt) < (force ? 60_000 : HISTORY_STALE_MS)) return before;
  const conn = await loadConnection().catch(() => null);
  if (!conn || conn.status !== "connected") return before;
  try {
    const lists = await cachedBookLists();
    const classes = names(lists.classes);
    const locations = names(lists.locations);
    const all: QboTxn[] = [];
    for (const type of TYPES) for (const raw of await readAll(type)) all.push(toTxn(type, raw, classes, locations));
    const byMonth = new Map<string, QboTxn[]>();
    for (const t of all) {
      const month = /^\d{4}-\d{2}/.test(t.date) ? t.date.slice(0, 7) : "0000-00";
      byMonth.set(month, [...(byMonth.get(month) ?? []), t]);
    }
    const kept = await client.fetch<{ _id: string; hash: string }[]>(`*[_type == "qboTxnMonth" && string::startsWith(_id, $prefix)]{ _id, hash }`, { prefix: QBO_TXN_MONTH_PREFIX });
    const hashes = new Map(kept.map((k) => [k._id, k.hash]));
    const tx = client.transaction();
    for (const [month, txns] of byMonth) {
      txns.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
      const json = JSON.stringify(txns);
      const hash = createHash("sha1").update(json).digest("hex");
      const id = QBO_TXN_MONTH_PREFIX + month;
      // What the month cost (bill payments only pay bills), for the home page's tile.
      const costs = Math.round(txns.filter((t) => t.type !== "BillPayment").reduce((n, t) => n + t.total, 0) * 100) / 100;
      if (hashes.get(id) !== hash) tx.createOrReplace({ _id: id, _type: "qboTxnMonth", month, count: txns.length, costs, hash, json });
      hashes.delete(id);
    }
    // Months with nothing left in the books.
    for (const id of hashes.keys()) tx.delete(id);
    const status: HistoryStatus = { fetchedAt: new Date().toISOString(), count: all.length, error: null };
    tx.createOrReplace({ _id: QBO_HISTORY_ID, _type: "qboHistory", ...status });
    await tx.commit();
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[quickbooks history]", message);
    const status = { ...before, error: message.slice(0, 300) };
    await client.createOrReplace({ _id: QBO_HISTORY_ID, _type: "qboHistory", ...status }).catch(() => {});
    return status;
  }
}
