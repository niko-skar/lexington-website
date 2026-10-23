import "server-only";
import { createHash } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { EXPENSE_PREFIX, EXPENSE_SETTINGS_ID, SHEET_DELETION_PREFIX } from "@/lib/site/ids";
import { FIELDS } from "./server";
import { isInflow, receiptFileName, vatParts, type Expense } from "./shared";

// Every expense and money in, copied to Niko's own Google Sheet, with the receipt saved in his
// Google Drive under a name that traces back to the entry (Niko, 23 Oct 2026: "so they can be
// easily traced and later put into the accounting software (quickbooks online)"). VAT receipts go
// to their own folder. The sheet's Apps Script (scripts/expense-sheet/Code.gs) does the Google
// side and runs as Niko, in his own Drive. The app stays the record: the sheet follows it, a
// minute behind at most, and catches up by itself after any failure (the cron every 15 minutes).

const url = () => process.env.EXPENSE_SHEET_URL;
const secret = () => process.env.EXPENSE_SHEET_SECRET;
export const sheetConfigured = () => !!(url() && secret());

/** The columns, left to right. The Apps Script writes them in this order under these headings. */
export const SHEET_COLUMNS = [
  "ID",
  "Ref",
  "Date",
  "Type",
  "For",
  "Category",
  "Supplier / from",
  "Description",
  "Material",
  "Qty",
  "Floor / area",
  "Paid by",
  "Amount (GHS)",
  "VAT",
  "VAT rate %",
  "VAT (GHS)",
  "Before VAT (GHS)",
  "Into store",
  "Receipt",
  "Receipt file",
  "Entered by",
  "Entered",
  "Last changed",
  "Status",
] as const;

type SheetState = { hash?: string; fileId?: string | null; fileUrl?: string | null; receiptAssetId?: string | null; syncedAt?: string; error?: string | null };
type SyncDoc = Expense & { sheet?: SheetState };

const gmt = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

function rowFor(x: SyncDoc): Record<string, string | number> {
  const { vat, net } = x.vat ? vatParts(x.amount, x.vatRate) : { vat: 0, net: x.amount };
  return {
    ID: x.id,
    Ref: x.ref ?? "",
    Date: x.date,
    Type: isInflow(x) ? "Money in" : "Expense",
    For: x.forWho,
    Category: x.category ?? "",
    "Supplier / from": x.supplier,
    Description: x.description,
    Material: x.material ?? "",
    Qty: x.qty ?? "",
    "Floor / area": x.floor ?? "",
    "Paid by": x.method ?? "",
    "Amount (GHS)": x.amount,
    VAT: x.vat ? "Yes" : "No",
    "VAT rate %": x.vat ? (x.vatRate ?? "") : "",
    "VAT (GHS)": x.vat ? vat : "",
    "Before VAT (GHS)": x.vat ? net : "",
    "Into store": x.toStore ? "Yes" : "",
    "Entered by": x.createdBy,
    Entered: gmt(x.createdAt),
    "Last changed": gmt(x.updatedAt),
    Status: "Active",
  };
}

/**
 * Apps Script answers a POST with a redirect to its output (".../macros/echo"). Now and then Google
 * instead sends the POST on to another script address; simply following that turns it into a GET,
 * which runs the script's "hello" page and saves nothing (23 Oct 2026: three rows never reached the
 * sheet while the site counted them as sent). So redirects are followed by hand: the output is
 * fetched, any other address gets the POST again (saving a row twice changes nothing).
 */
async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const payload = JSON.stringify({ secret: secret(), ...body });
  const signal = AbortSignal.timeout(50_000);
  let target = new URL(url()!);
  let response = await fetch(target, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: payload, redirect: "manual", signal });
  for (let hop = 0; hop < 4; hop++) {
    const next = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!next) break;
    target = new URL(next, target);
    response = /\/echo$/.test(target.pathname)
      ? await fetch(target, { redirect: "follow", signal })
      : await fetch(target, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: payload, redirect: "manual", signal });
  }
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`The sheet answered ${response.status} without the expected reply`);
  }
  if (!response.ok || data.ok !== true) throw new Error(String(data.error || `The sheet answered ${response.status}`));
  // The "hello" page answered, not the save: count it as not sent, so it goes again.
  if ("hello" in data) throw new Error("The sheet didn't save it (Google answered like a page visit). It goes again on the next round.");
  return data;
}

const SYNC_FIELDS = FIELDS.replace(/}\s*$/, `, "sheet": sheet, "receiptAssetId": receipt.asset._ref }`);

async function load(ids: string[] | null): Promise<(SyncDoc & { receiptAssetId?: string })[]> {
  return getBuyersClient().fetch(
    ids
      ? `*[_type == "siteExpense" && _id in $ids] ${SYNC_FIELDS}`
      : `*[_type == "siteExpense" && string::startsWith(_id, $prefix)] | order(date asc, createdAt asc) ${SYNC_FIELDS}`,
    { ids: ids ?? [], prefix: EXPENSE_PREFIX }
  );
}

function plan(x: SyncDoc & { receiptAssetId?: string }) {
  const row = rowFor(x);
  const fileName = x.receiptUrl ? receiptFileName(x, x.receiptType) : "";
  const folder = x.vat ? "VAT receipts" : "Receipts";
  const hash = createHash("sha1")
    .update(JSON.stringify([row, fileName, folder, x.receiptAssetId ?? null]))
    .digest("hex");
  return { row, fileName, folder, hash };
}

/** Sends one entry to the sheet if it changed since it was last sent. */
async function syncOne(x: SyncDoc & { receiptAssetId?: string }): Promise<"sent" | "same" | "failed"> {
  const { row, fileName, folder, hash } = plan(x);
  const state = x.sheet ?? {};
  if (state.hash === hash && !state.error) return "same";
  const client = getBuyersClient();
  try {
    // The receipt file goes over only when it's new or replaced; otherwise the sheet renames
    // or moves the copy it already has.
    let file: { name: string; mimeType: string; data: string } | null = null;
    if (x.receiptUrl && x.receiptAssetId && (state.receiptAssetId !== x.receiptAssetId || !state.fileId)) {
      const response = await fetch(x.receiptUrl, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`The receipt couldn't be fetched (${response.status})`);
      file = { name: fileName, mimeType: x.receiptType || "image/jpeg", data: Buffer.from(await response.arrayBuffer()).toString("base64") };
    }
    const answer = await post({
      action: "upsert",
      columns: SHEET_COLUMNS,
      row,
      file,
      fileId: state.fileId ?? null,
      receiptAssetId: x.receiptUrl ? (x.receiptAssetId ?? null) : null,
      fileName,
      folder,
    });
    await client
      .patch(x.id)
      .set({
        sheet: {
          hash,
          fileId: (answer.fileId as string) ?? null,
          fileUrl: (answer.fileUrl as string) ?? null,
          receiptAssetId: x.receiptAssetId ?? null,
          syncedAt: new Date().toISOString(),
          error: null,
        },
      })
      .commit();
    if (typeof answer.sheetUrl === "string") await rememberSheetUrl(answer.sheetUrl);
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sheet] ${x.ref ?? x.id}:`, message);
    await client
      .patch(x.id)
      .set({
        "sheet.error": message.slice(0, 300),
        "sheet.failedAt": new Date().toISOString(),
        // The copy in Drive is gone: send the receipt itself next time.
        ...(message.includes("send it again") ? { "sheet.fileId": null } : {}),
      })
      .commit()
      .catch(() => {});
    return "failed";
  }
}

/** One entry, straight after it's saved (runs after the phone already has its answer). */
export async function syncExpense(id: string): Promise<void> {
  if (!sheetConfigured()) return;
  const [x] = await load([id]);
  if (x) await syncOne(x);
}

/** Deleted entries: their sheet rows marked "Deleted", their receipt copies moved aside. */
async function syncDeletions(limit: number): Promise<number> {
  const client = getBuyersClient();
  const gone = await client.fetch<{ _id: string; expenseId: string; ref?: string; fileId?: string }[]>(
    `*[_type == "expenseSheetDeletion" && string::startsWith(_id, $prefix)] | order(at asc)[0...$limit]{ _id, expenseId, ref, fileId }`,
    { prefix: SHEET_DELETION_PREFIX, limit }
  );
  let done = 0;
  for (const g of gone) {
    try {
      await post({ action: "delete", id: g.expenseId, ref: g.ref ?? null, fileId: g.fileId ?? null });
      await client.delete(g._id);
      done++;
    } catch (error) {
      console.error(`[sheet] delete ${g.ref ?? g.expenseId}:`, error instanceof Error ? error.message : error);
    }
  }
  return done;
}

/** Catches the sheet up: what's new or changed (oldest first), and what was deleted. */
export async function syncPending(limit = 25): Promise<{ sent: number; failed: number; waiting: number; deleted: number }> {
  if (!sheetConfigured()) return { sent: 0, failed: 0, waiting: 0, deleted: 0 };
  const all = await load(null);
  const due = all.filter((x) => {
    const state = x.sheet ?? {};
    return state.error || state.hash !== plan(x).hash;
  });
  let sent = 0;
  let failed = 0;
  const started = Date.now();
  for (const x of due.slice(0, limit)) {
    if (Date.now() - started > 200_000) break; // leave time to answer before the function's limit
    const result = await syncOne(x);
    if (result === "sent") sent++;
    if (result === "failed") failed++;
  }
  const deleted = await syncDeletions(20);
  return { sent, failed, waiting: Math.max(0, due.length - sent), deleted };
}

/** For the app's menu: is the sheet set up, and how far behind is it? */
export async function sheetStatus(): Promise<{ configured: boolean; waiting: number; failed: number; lastSyncedAt: string | null; sheetUrl: string | null }> {
  if (!sheetConfigured()) return { configured: false, waiting: 0, failed: 0, lastSyncedAt: null, sheetUrl: null };
  const all = await load(null);
  let waiting = 0;
  let failed = 0;
  let last: string | null = null;
  for (const x of all) {
    const state = x.sheet ?? {};
    if (state.error) failed++;
    else if (state.hash !== plan(x).hash) waiting++;
    if (state.syncedAt && (!last || state.syncedAt > last)) last = state.syncedAt;
  }
  const sheetUrl = await getBuyersClient().fetch<string | null>(`*[_id == $id][0].sheetUrl`, { id: EXPENSE_SETTINGS_ID });
  return { configured: true, waiting, failed, lastSyncedAt: last, sheetUrl };
}

async function rememberSheetUrl(sheetUrl: string) {
  try {
    await getBuyersClient().createIfNotExists({ _id: EXPENSE_SETTINGS_ID, _type: "siteExpenseSettings" });
    await getBuyersClient().patch(EXPENSE_SETTINGS_ID).set({ sheetUrl }).commit();
  } catch {
    /* only a convenience link for the menu */
  }
}
