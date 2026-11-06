import "server-only";

import { qboApi, QboError } from "@/lib/quickbooks/client";
import { syncHistory } from "@/lib/quickbooks/history";
import { writeLog } from "@/lib/quickbooks/store";
import { TodoError } from "@/lib/todo/server";
import { isDay, type QboTxn } from "./shared";

// Putting the dates right in QuickBooks (Niko, 6 Nov 2026: "can you bulk reverse the dates on qbo for me?"): the
// entries dated long after they were typed, each with the date the office ticked on the Spending page (its day and
// month swapped, or one typed). Only the date changes (a sparse update), and only while QuickBooks still has the date
// the page showed: a second tap never swaps one back. Then the books are read again, so the page shows them moved.

export interface DateFix {
  /** The entry's key on the Spending page: "qbo:Purchase:123". */
  key: string;
  /** The date it has now, as the page showed it. */
  from: string;
  /** The date it should have. */
  to: string;
}

export interface DateFixResult {
  key: string;
  ok: boolean;
  /** Why it wasn't changed. */
  why?: string;
}

export const MAX_DATE_FIXES = 100;
const KEY = /^qbo:(Purchase|Bill|VendorCredit|BillPayment):(\d{1,20})$/;
const ENDPOINTS: Record<QboTxn["type"], string> = { Purchase: "purchase", Bill: "bill", VendorCredit: "vendorcredit", BillPayment: "billpayment" };

/** The fixes as sent, checked: QuickBooks entries, real days, none after today, each entry once. */
export function cleanDateFixes(value: unknown, today: string): DateFix[] {
  if (!Array.isArray(value) || value.length === 0) throw new TodoError(400, "Tick at least one entry to fix.");
  if (value.length > MAX_DATE_FIXES) throw new TodoError(400, `At most ${MAX_DATE_FIXES} at a time.`);
  const seen = new Set<string>();
  return value.map((v) => {
    const x = (v ?? {}) as Record<string, unknown>;
    const key = typeof x.key === "string" ? x.key : "";
    const from = typeof x.from === "string" ? x.from : "";
    const to = typeof x.to === "string" ? x.to : "";
    if (!KEY.test(key) || seen.has(key)) throw new TodoError(400, "One of them isn't a QuickBooks entry on the list.");
    if (!isDay(from) || !isDay(to)) throw new TodoError(400, "Each one needs a whole date (day, month and year).");
    if (to > today) throw new TodoError(400, `${to} is after today: pick the day it really was.`);
    if (to === from) throw new TodoError(400, "One of them already has that date.");
    seen.add(key);
    return { key, from, to };
  });
}

async function fixOne(f: DateFix): Promise<DateFixResult> {
  const [, type, id] = KEY.exec(f.key)!;
  const path = ENDPOINTS[type as QboTxn["type"]];
  try {
    const current = (await qboApi<Record<string, { Id: string; SyncToken: string; TxnDate?: string } | undefined>>(`${path}/${id}`))[type];
    if (!current) return { key: f.key, ok: false, why: "QuickBooks doesn't have it any more." };
    if (current.TxnDate !== f.from) return { key: f.key, ok: false, why: `QuickBooks has it on ${current.TxnDate ?? "no date"} now: left as it is.` };
    await qboApi(path, { method: "POST", body: { Id: current.Id, SyncToken: current.SyncToken, sparse: true, TxnDate: f.to } });
    await writeLog({ action: "api", ok: true, httpStatus: 200, intuitTid: null, message: `Spending, fix the dates: ${type} ${id} dated ${f.from} -> ${f.to}` });
    return { key: f.key, ok: true };
  } catch (error) {
    return { key: f.key, ok: false, why: error instanceof QboError ? error.message : "QuickBooks could not be reached." };
  }
}

/** Each fix into QuickBooks (a few at a time: QuickBooks takes ten at once from one app), then the books read again. */
export async function fixDates(fixes: readonly DateFix[]): Promise<DateFixResult[]> {
  const results: DateFixResult[] = [];
  for (let i = 0; i < fixes.length; i += 4) results.push(...(await Promise.all(fixes.slice(i, i + 4).map(fixOne))));
  if (results.some((r) => r.ok)) await syncHistory("now");
  return results;
}
