import "server-only";
import { createHash, randomBytes } from "node:crypto";

import { areasWith } from "@/lib/quickbooks/books";
import { cleanOrderLink, orderUsed } from "@/lib/orders/link";
import { cleanAlreadyIn, orderCheckIns, orderOfPayment } from "@/lib/store/deliveriesServer";
import { cachedBookLists } from "@/lib/quickbooks/booksCache";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BILL_PREFIX, EXPENSE_COUNTER_ID, EXPENSE_PREFIX, EXPENSE_SETTINGS_ID, isId, newId, QBO_GONE_PREFIX, SHEET_DELETION_PREFIX } from "@/lib/site/ids";
import { itemForPurchase } from "@/lib/store/server";
import { cleanText, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { STEEL_RATE } from "./steel";
import {
  CATEGORIES,
  EXTRA_CATEGORIES,
  FLOORS,
  FOR_WHO,
  MAX_DESCRIPTION,
  MAX_EXTRAS,
  MAX_MATERIAL,
  MAX_SUPPLIER,
  MAX_LINES,
  MAX_RECEIPTS,
  METHODS,
  money,
  todayISO,
  VAT_RATE,
  type Expense,
  type ExtraCategory,
} from "./shared";

// Sanity asset ids: image-<sha1>-<width>x<height>-<format>, file-<sha1>-<extension>.
const RECEIPT_ID_RE = /^(image-[a-f0-9]{40}-\d+x\d+-(jpg|png|webp)|file-[a-f0-9]{40}-pdf)$/;

export const FIELDS = `{
  "id": _id,
  "ref": ref,
  date,
  "kind": coalesce(kind, "expense"),
  "forWho": coalesce(forWho, "Site"),
  amount,
  "vat": coalesce(vat, false),
  "vatRate": vatRate,
  "supplier": coalesce(supplier, ""),
  "description": coalesce(description, ""),
  "floor": floor,
  "method": method,
  "category": category,
  "material": material,
  "qty": qty,
  "itemId": itemId,
  "toStore": coalesce(toStore, false),
  "alreadyIn": alreadyIn,
  "receiptId": receipt.asset._ref,
  "receiptUrl": receipt.asset->url,
  "receiptType": receipt.asset->mimeType,
  "driveUrl": sheet.fileUrl,
  "bank": bank{ at, account, balance, "matched": coalesce(matched, false) },
  "costClass": costClass{ id, name },
  "payday": payday{ week, kind, lines[]{ id, name, group, amount, at, ref } },
  "steelTons": steelTons,
  "billId": billId,
  "poId": poId,
  "withId": withId,
  "moreReceipts": coalesce(moreReceipts[defined(asset)]{ "id": asset._ref, "url": asset->url, "type": asset->mimeType }, []),
  "moreLines": coalesce(moreLines[]{ material, qty, itemId, "toStore": coalesce(toStore, false), alreadyIn }, []),
  createdAt,
  "createdBy": coalesce(createdBy, ""),
  "updatedAt": coalesce(updatedAt, sourceUpdatedAt, createdAt)
}`;

/** Everything, newest first (the page filters by month, who for and floor itself). */
export async function listExpenses(): Promise<Expense[]> {
  return getBuyersClient().fetch<Expense[]>(
    `*[_type == "siteExpense" && string::startsWith(_id, $prefix)] | order(date desc, createdAt desc)[0...10000] ${FIELDS}`,
    { prefix: EXPENSE_PREFIX }
  );
}

async function getExpense(id: string): Promise<Expense | null> {
  return getBuyersClient().fetch<Expense | null>(`*[_id == $id && _type == "siteExpense"][0] ${FIELDS}`, { id });
}

/* ---------- references: EXP-0001, IN-0001 ---------- */

type Counter = { _rev: string; expense?: number; inflow?: number };
const refOf = (kind: "expense" | "inflow", n: number) => `${kind === "inflow" ? "IN" : "EXP"}-${String(n).padStart(4, "0")}`;

/** Where the numbers stand when there is no counter yet: the highest ref, or else how many entries there are. */
async function startingNumbers(): Promise<{ expense: number; inflow: number }> {
  const rows = await getBuyersClient().fetch<{ kind: string; ref?: string }[]>(
    `*[_type == "siteExpense" && string::startsWith(_id, $prefix)]{ "kind": coalesce(kind, "expense"), ref }`,
    { prefix: EXPENSE_PREFIX }
  );
  const top = (kind: string) => {
    const mine = rows.filter((r) => r.kind === kind);
    const refs = mine.map((r) => Number(/^(?:EXP|IN)-(\d+)$/.exec(r.ref ?? "")?.[1] ?? 0));
    return Math.max(mine.length, ...refs, 0);
  };
  return { expense: top("expense"), inflow: top("inflow") };
}

/** The next reference for a new entry. Two saves at once never get the same number. */
export async function nextRef(kind: "expense" | "inflow"): Promise<string> {
  const client = getBuyersClient();
  for (let attempt = 0; attempt < 8; attempt++) {
    const counter = await client.fetch<Counter | null>(`*[_id == $id][0]{ _rev, expense, inflow }`, { id: EXPENSE_COUNTER_ID });
    try {
      if (!counter) {
        const start = await startingNumbers();
        const n = start[kind] + 1;
        await client.create({ _id: EXPENSE_COUNTER_ID, _type: "siteExpenseCounter", ...start, [kind]: n });
        return refOf(kind, n);
      }
      const n = (counter[kind] ?? 0) + 1;
      await client.patch(EXPENSE_COUNTER_ID).ifRevisionId(counter._rev).set({ [kind]: n }).commit();
      return refOf(kind, n);
    } catch {
      // Someone else took that number a moment ago: read the counter again.
      await new Promise((r) => setTimeout(r, 80 + Math.random() * 200));
    }
  }
  throw new TodoError(503, "Couldn't number the entry. Try again.");
}

/* ---------- checking what the phone sent ---------- */

function pick<T extends string>(value: unknown, list: readonly T[], message: string): T {
  if (typeof value !== "string" || !(list as readonly string[]).includes(value)) throw new TodoError(400, message);
  return value as T;
}

function cleanDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) {
    throw new TodoError(400, "Pick the date it was paid.");
  }
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); // a phone just past midnight, ahead of the server
  if (value > todayISO(tomorrow) || value < "2020-01-01") throw new TodoError(400, "That date isn't right: pick the day it was paid.");
  return value;
}

function cleanNumber(value: unknown, message: string) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) throw new TodoError(400, message);
  return n;
}

function cleanReceiptId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !RECEIPT_ID_RE.test(value)) throw new TodoError(400, "The receipt didn't upload properly. Add it again.");
  return value;
}

/** What gets saved, in the shape the old expense page saved it (so its entries carry over as they are). */
/** The entry as typed, checked. `self`: the entry being changed (its own payment of a bill doesn't count twice). */
async function fields(me: TodoMe, body: Record<string, unknown>, receiptId: string | null, self: string | null = null) {
  const kind: "expense" | "inflow" = body.kind === "inflow" ? "inflow" : "expense";
  const inflow = kind === "inflow";
  const forWho = pick(body.forWho ?? "Site", FOR_WHO, "Pick who it's for: Site, House, Niko or Event.");
  const amount = Math.round(cleanNumber(body.amount, inflow ? "Enter the amount received." : "Enter the amount paid.") * 100) / 100;
  const method = pick(body.method, METHODS, inflow ? "Pick how the money came in." : "Pick how it was paid.");
  const category = inflow ? null : pick(body.category, CATEGORIES, "Pick Material, Service or Other.");
  // The floors, and the QuickBooks locations that aren't one ("Foundations", "Stormdrain").
  const areas = inflow || forWho !== "Site" ? [] : areasWith(FLOORS, (await cachedBookLists().catch(() => ({ locations: [] }))).locations);
  const floor = inflow || forWho !== "Site" ? null : pick(body.floor, areas, "Pick the floor or area.");
  // VAT is in the amount; Niko, 23 Oct 2026: "if VAT is ticked then a photo is required".
  const vat = body.vat === true;
  let vatRate: number | null = null;
  if (vat) {
    const rate = body.vatRate === undefined || body.vatRate === null || body.vatRate === "" ? VAT_RATE : Number(body.vatRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 50) throw new TodoError(400, "Type the VAT rate in percent, e.g. 20.");
    vatRate = Math.round(rate * 100) / 100;
    if (!receiptId) throw new TodoError(400, "With VAT, the receipt is a must: take a photo of it or upload it.");
  }
  let material: string | null = null;
  let qty: number | null = null;
  let itemId: string | null = null;
  let toStore = false;
  let alreadyIn: string | null = null;
  if (category === "Material") {
    material = cleanText(body.material, MAX_MATERIAL, "material").replace(/\s+/g, " ");
    if (!material) throw new TodoError(400, "Write which material you bought.");
    qty = Math.round(cleanNumber(body.qty ?? 1, "Pick how many.") * 1000) / 1000;
    if (body.toStore === true) {
      const item = await itemForPurchase(me, material, body.unit);
      itemId = item.id;
      material = item.name;
      toStore = true;
      // Goods checked in at the store already ("Already in the store?" yes): the stock had them then.
      alreadyIn = await cleanAlreadyIn(body.alreadyIn, itemId, self);
    }
  }
  return {
    date: cleanDate(body.date),
    kind,
    forWho,
    amount,
    vat,
    vatRate,
    supplier: cleanText(body.supplier, MAX_SUPPLIER, "supplier"),
    description: cleanText(body.description, MAX_DESCRIPTION, "description"),
    floor,
    method,
    category,
    material,
    qty,
    itemId,
    toStore,
    // A change from a page that doesn't know about deliveries leaves the tie as it was.
    ...(self && body.alreadyIn === undefined ? {} : { alreadyIn }),
    // The QuickBooks class (cost type): site expenses only.
    costClass: inflow || forWho !== "Site" ? null : cleanClass(body.costClass),
    // The supplier's bill it pays (lib/suppliers): money out only.
    billId: inflow ? null : await cleanBillId(body.billId, amount, self),
    // The purchase order it pays for (lib/orders): set when it's made from one ("Pay it now"); a change leaves it be.
    ...(!self && !inflow && body.poId ? { poId: await cleanOrderLink(body.poId) } : {}),
    moreLines: category === "Material" ? await cleanMoreLines(me, body.moreLines, self) : [],
  };
}

/** More materials on one entry (the first is the entry's own): each named, how many, and into the store room or not. */
type CleanLine = { _key: string; material: string; qty: number; itemId: string | null; toStore: boolean; alreadyIn: string | null };
async function cleanMoreLines(me: TodoMe, value: unknown, self: string | null): Promise<CleanLine[]> {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TodoError(400, "The materials didn't come through: try again.");
  if (value.length > MAX_LINES - 1) throw new TodoError(400, `${MAX_LINES} materials at most on one entry.`);
  const out: CleanLine[] = [];
  for (const raw of value) {
    const line = (raw ?? {}) as Record<string, unknown>;
    let material = cleanText(line.material, MAX_MATERIAL, "material").replace(/\s+/g, " ");
    if (!material) throw new TodoError(400, "Write which material each line is, or take the empty line off.");
    const qty = Math.round(cleanNumber(line.qty ?? 1, "Pick how many of each.") * 1000) / 1000;
    let itemId: string | null = null;
    let alreadyIn: string | null = null;
    const toStore = line.toStore === true;
    if (toStore) {
      const item = await itemForPurchase(me, material, line.unit);
      itemId = item.id;
      material = item.name;
      alreadyIn = await cleanAlreadyIn(line.alreadyIn, itemId, self);
    }
    out.push({ _key: randomBytes(4).toString("hex"), material, qty, itemId, toStore, alreadyIn });
  }
  return out;
}

/** More photos with the receipt: stored ones (photos or PDFs), at most MAX_RECEIPTS with the receipt. */
function cleanMoreReceipts(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TodoError(400, "The photos didn't come through: add them again.");
  const ids = [...new Set(value.map((v) => cleanReceiptId(v)).filter((v): v is string => !!v))];
  if (ids.length > MAX_RECEIPTS - 1) throw new TodoError(400, `${MAX_RECEIPTS} photos at most on one entry.`);
  return ids;
}
const moreReceiptRefs = (ids: string[]) => ids.map((id) => ({ _key: randomBytes(4).toString("hex"), ...receiptRef(id) }));

/**
 * The bill a payment pays: one that's there (not deleted), or none. It can't pay more than the bill has left
 * (QuickBooks would refuse the bill payment): the rest goes in as an expense of its own, or the bill is changed first.
 */
async function cleanBillId(value: unknown, amount: number, self: string | null): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  if (!isId(BILL_PREFIX, value)) throw new TodoError(404, "That bill isn't there any more: pick it again.");
  const bill = await getBuyersClient().fetch<{ amount: number; appRef: string | null; paid: number | null } | null>(
    `*[_id == $id && _type == "supplierBill" && !coalesce(deleted, false)][0]{ amount, appRef, "paid": math::sum(*[_type == "siteExpense" && billId == $id && _id != $self && coalesce(kind, "expense") == "expense"].amount) }`,
    { id: value, self: self ?? "" }
  );
  if (!bill) throw new TodoError(404, "That bill isn't there any more: pick it again.");
  const left = Math.round((bill.amount - (bill.paid ?? 0)) * 100) / 100;
  if (amount > left + 0.005) {
    throw new TodoError(
      400,
      left > 0
        ? `That's more than the ${money(left)} left on ${bill.appRef ?? "the bill"}. Change the bill first (on the supplier's page), or put the rest in as an expense of its own.`
        : `${bill.appRef ?? "That bill"} is paid off already: pick "No bill".`
    );
  }
  return value;
}

function cleanClass(value: unknown): { id: string; name: string } | null {
  if (value === null || value === undefined || value === "") return null;
  const v = value as { id?: unknown; name?: unknown };
  if (typeof v !== "object" || typeof v.id !== "string" || typeof v.name !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(v.id) || !v.name.trim() || v.name.length > 150) {
    throw new TodoError(400, "Pick the cost type again.");
  }
  return { id: v.id, name: v.name.trim() };
}

/** Wages paid in Payday are kept by the roll call: changed or removed there, never here. */
const FROM_PAYDAY = "This comes from Payday: change the payments there and it follows.";

const receiptRef = (assetId: string) => ({
  _type: assetId.startsWith("file-") ? "file" : "image",
  asset: { _type: "reference", _ref: assetId },
});

/* ---------- saving ---------- */

/** A new entry. `extra` is saved with it as it is (the bank text's note on money in it added). */
export async function createExpense(me: TodoMe, body: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<Expense> {
  const receiptId = cleanReceiptId(body.receiptId);
  const more = cleanMoreReceipts(body.moreReceiptIds);
  if (more.length && !receiptId) throw new TodoError(400, "Add the receipt first, then the other photos.");
  const data = await fields(me, body, receiptId);
  // Paying for an order (or its bill) whose goods were checked in already: those lines are tied to the check-ins.
  const order = data.kind === "expense" ? await orderOfPayment("poId" in data ? data.poId : null, data.billId) : null;
  if (order) {
    const checkIns = await orderCheckIns(order);
    const tie = (line: { itemId: string | null; toStore: boolean; alreadyIn?: string | null }) => {
      const found = line.toStore && line.itemId && !line.alreadyIn ? checkIns.get(line.itemId) : undefined;
      if (!found || !line.itemId) return null;
      checkIns.delete(line.itemId);
      return found;
    };
    const main = tie({ itemId: data.itemId, toStore: data.toStore, alreadyIn: "alreadyIn" in data ? data.alreadyIn : null });
    if (main) Object.assign(data, { alreadyIn: main });
    for (const l of data.moreLines) l.alreadyIn = tie(l) ?? l.alreadyIn;
  }
  const id = newId(EXPENSE_PREFIX);
  const now = new Date().toISOString();
  await getBuyersClient().create({
    _id: id,
    _type: "siteExpense",
    ref: await nextRef(data.kind),
    ...data,
    ...extra,
    ...(receiptId ? { receipt: receiptRef(receiptId) } : {}),
    ...(more.length ? { moreReceipts: moreReceiptRefs(more) } : {}),
    createdAt: now,
    createdBy: me.name,
    updatedAt: now,
  });
  // Paid for a purchase order: an order still to place is ordered now.
  if ("poId" in data && data.poId) await orderUsed(me, data.poId);
  const expense = await getExpense(id);
  if (!expense) throw new TodoError(502, "It was saved but couldn't be read back. Refresh the page.");
  return expense;
}

/** The other costs sent with a new entry, checked before anything is saved: what each is, how much, its class. */
function cleanExtras(value: unknown): Array<{ category: ExtraCategory; description: string; amount: number; costClass: unknown }> {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TodoError(400, "The other costs didn't come through: try again.");
  if (value.length > MAX_EXTRAS) throw new TodoError(400, `${MAX_EXTRAS} other costs at most on one receipt.`);
  return value.map((raw) => {
    const line = (raw ?? {}) as Record<string, unknown>;
    const description = cleanText(line.description, MAX_DESCRIPTION, "description");
    if (!description) throw new TodoError(400, "Say what each other cost is, e.g. Transport.");
    const amount = Math.round(cleanNumber(line.amount, `Enter how much the ${description.toLowerCase()} was.`) * 100) / 100;
    if (!(amount > 0)) throw new TodoError(400, `Enter how much the ${description.toLowerCase()} was.`);
    const category = pick(line.category ?? "Service", EXTRA_CATEGORIES, "Pick Service or Other for each other cost.");
    return { category, description, amount, costClass: line.costClass };
  });
}

/**
 * A new entry with other costs on the same receipt (the bill's wawa boards, and the transport): the entry, then each
 * other cost as an entry of its own on the same day, supplier, payment and photos (so each has its own class in
 * QuickBooks, and the bill is paid exactly what it's owed). `amount` is the entry's own part.
 */
export async function createWithExtras(me: TodoMe, body: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<{ expense: Expense; extras: Expense[] }> {
  const extras = body.kind === "inflow" ? [] : cleanExtras(body.extras);
  const expense = await createExpense(me, body, extra);
  const made: Expense[] = [];
  for (const e of extras) {
    made.push(
      await createExpense(
        me,
        {
          date: body.date,
          kind: "expense",
          forWho: body.forWho,
          amount: e.amount,
          vat: false,
          method: body.method,
          category: e.category,
          supplier: body.supplier,
          description: e.description,
          floor: body.floor,
          costClass: e.costClass,
          receiptId: body.receiptId,
          moreReceiptIds: body.moreReceiptIds,
          // The transport on a purchase order's receipt is part of that order too.
          poId: expense.poId,
        },
        { withId: expense.id }
      )
    );
  }
  return { expense, extras: made };
}

/** What a new entry and its other costs come to (the bank's debit is for all of it). */
export const totalWithExtras = (body: Record<string, unknown>): unknown => {
  if (!Array.isArray(body.extras) || !body.extras.length) return body.amount;
  const n = (v: unknown) => Number(String(v ?? "").replace(/,/g, "")) || 0;
  return Math.round((n(body.amount) + body.extras.reduce((sum: number, e) => sum + n((e as { amount?: unknown })?.amount), 0)) * 100) / 100;
};

export async function updateExpense(me: TodoMe, id: string, body: Record<string, unknown>): Promise<Expense> {
  if (!isId(EXPENSE_PREFIX, id)) throw new TodoError(404, "That entry isn't there any more.");
  const client = getBuyersClient();
  const before = await client.fetch<{ receipt?: string; more: string[] | null; ref?: string; kind?: string; payday: boolean } | null>(
    `*[_id == $id && _type == "siteExpense"][0]{ "receipt": receipt.asset._ref, "more": moreReceipts[].asset._ref, ref, "kind": coalesce(kind, "expense"), "payday": defined(payday) }`,
    { id }
  );
  if (!before) throw new TodoError(404, "That entry isn't there any more.");
  if (before.payday) throw new TodoError(409, FROM_PAYDAY);
  const receiptId = cleanReceiptId(body.receiptId);
  // Sent without its photos list (an older page): the photos stay as they are.
  const more = body.moreReceiptIds === undefined ? (before.more ?? []) : cleanMoreReceipts(body.moreReceiptIds);
  if (more.length && !receiptId) throw new TodoError(400, "Add the receipt first, then the other photos.");
  const data = await fields(me, body, receiptId, id);
  // Switched between expense and money in: it takes a number from the other series.
  const ref = before.ref && before.kind === data.kind ? before.ref : await nextRef(data.kind);
  const set = { ...data, ref, updatedAt: new Date().toISOString(), updatedBy: me.name, ...(receiptId ? { receipt: receiptRef(receiptId) } : {}) };
  // The same photos keep their place (and their copies in QuickBooks); new ones join them.
  const keptMore = (before.more ?? []).join() === more.join();
  let patch = client.patch(id).set(keptMore ? set : { ...set, ...(more.length ? { moreReceipts: moreReceiptRefs(more) } : {}) });
  if (!receiptId) patch = patch.unset(["receipt"]);
  if (!keptMore && !more.length) patch = patch.unset(["moreReceipts"]);
  await patch.commit();
  if (before.receipt && before.receipt !== receiptId) await dropReceipt(before.receipt);
  for (const gone of (before.more ?? []).filter((m) => !more.includes(m) && m !== receiptId)) await dropReceipt(gone);
  const expense = await getExpense(id);
  if (!expense) throw new TodoError(404, "That entry isn't there any more.");
  return expense;
}

/**
 * Gone from the app at once; the Google Sheet row is marked "Deleted" and its receipt moved aside.
 * One that already went to QuickBooks is listed on the QuickBooks page to remove there by hand
 * (the app never deletes anything in the books).
 */
export async function deleteExpense(id: string, { payday = false } = {}): Promise<void> {
  if (!isId(EXPENSE_PREFIX, id)) throw new TodoError(404, "That entry isn't there any more.");
  if (!payday && (await getBuyersClient().fetch<boolean>(`defined(*[_id == $id][0].payday)`, { id }))) throw new TodoError(409, FROM_PAYDAY);
  const client = getBuyersClient();
  const before = await client.fetch<{
    receipt?: string;
    more?: string[] | null;
    ref?: string;
    fileId?: string;
    synced?: string;
    qboType?: string;
    qboTxn?: string;
    qboRealm?: string;
  } | null>(
    `*[_id == $id && _type == "siteExpense"][0]{ "receipt": receipt.asset._ref, "more": moreReceipts[].asset._ref, ref, "fileId": sheet.fileId, "synced": sheet.syncedAt, "qboType": qbo.txnType, "qboTxn": qbo.txnId, "qboRealm": qbo.realmId }`,
    { id }
  );
  if (!before) return;
  const tx = client.transaction().delete(id);
  // Only rows the sheet already has need marking.
  if (before.synced) {
    tx.create({ _id: `${SHEET_DELETION_PREFIX}${randomBytes(6).toString("hex")}`, _type: "expenseSheetDeletion", expenseId: id, ref: before.ref ?? null, fileId: before.fileId ?? null, at: new Date().toISOString() });
  }
  if (before.qboTxn) {
    tx.create({
      _id: `${QBO_GONE_PREFIX}${randomBytes(6).toString("hex")}`,
      _type: "qboGone",
      expenseId: id,
      ref: before.ref ?? null,
      txnType: before.qboType ?? null,
      txnId: before.qboTxn,
      realmId: before.qboRealm ?? null,
      reason: "Deleted in the site app",
      at: new Date().toISOString(),
    });
  }
  await tx.commit();
  if (before.receipt) await dropReceipt(before.receipt);
  for (const m of before.more ?? []) await dropReceipt(m);
}

/* ---------- receipts ---------- */

const MAX_BYTES = 4_400_000; // photos are shrunk on the phone first; Vercel refuses over 4.5 MB anyway
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function storeReceipt(file: File): Promise<{ id: string; url: string; type: string }> {
  const pdf = file.type === "application/pdf";
  if (!pdf && !IMAGE_TYPES.includes(file.type)) throw new TodoError(415, "That file can't be attached. Use a photo or a PDF.");
  if (file.size === 0) throw new TodoError(400, "No receipt was sent.");
  if (file.size > MAX_BYTES) throw new TodoError(413, pdf ? "That PDF is too big (over 4 MB). Take a photo of it instead." : "That photo is too big (over 4 MB).");
  const ext = pdf ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const asset = await getBuyersClient().assets.upload(pdf ? "file" : "image", Buffer.from(await file.arrayBuffer()), {
    filename: `receipt-${todayISO()}-${randomBytes(3).toString("hex")}.${ext}`,
    contentType: file.type,
  });
  return { id: asset._id, url: asset.url, type: file.type };
}

/** Deletes a receipt nothing points at any more (replaced, removed, or its entry deleted). */
export async function dropReceipt(assetId: string): Promise<void> {
  if (!RECEIPT_ID_RE.test(assetId)) return;
  const client = getBuyersClient();
  try {
    const info = await client.fetch<{ name?: string; refs: number } | null>(
      `*[_id == $id][0]{ "name": originalFilename, "refs": count(*[references(^._id)]) }`,
      { id: assetId }
    );
    if (info && info.refs === 0 && info.name?.startsWith("receipt-")) await client.delete(assetId);
  } catch (error) {
    console.error("[expenses] receipt clean-up failed:", error instanceof Error ? error.message : error);
  }
}

/* ---------- wages from Payday ---------- */

export interface PaydayEntryData {
  date: string;
  amount: number;
  method: string;
  supplier: string;
  description: string;
  costClass: { id: string; name: string } | null;
  /** The QuickBooks location chosen in Payday (its name), or "Whole building" when none was. */
  floor: string;
  payday: { week: string; kind: "workers" | "machines"; lines: Array<{ id: string; name: string; group: string; amount: number; at: string; ref: string | null }> };
}

/**
 * A pay week's wage entry made, brought up to date, or removed (null) by the roll call (lib/rollcall/wages.ts).
 * It keeps its number; an unchanged week changes nothing. Returns the content's fingerprint when it changed.
 */
export async function savePaydayEntry(id: string, data: PaydayEntryData | null): Promise<string | null> {
  const client = getBuyersClient();
  const before = await client.fetch<{ hash?: string } | null>(`*[_id == $id && _type == "siteExpense"][0]{ "hash": payday.hash }`, { id });
  if (!data) {
    if (before) await deleteExpense(id, { payday: true });
    return before ? "removed" : null;
  }
  const hash = createHash("sha1").update(JSON.stringify(data)).digest("hex");
  if (before?.hash === hash) return null;
  const now = new Date().toISOString();
  const set = {
    date: data.date,
    kind: "expense",
    forWho: "Site",
    amount: data.amount,
    vat: false,
    vatRate: null,
    supplier: data.supplier,
    description: data.description,
    floor: data.floor,
    method: data.method,
    category: "Service",
    material: null,
    qty: null,
    itemId: null,
    toStore: false,
    costClass: data.costClass,
    payday: { ...data.payday, lines: data.payday.lines.map((l) => ({ _key: l.id, ...l })), hash },
    updatedAt: now,
    updatedBy: "Payday",
  };
  if (before) {
    await client.patch(id).set(set).commit();
    return hash;
  }
  try {
    await client.create({ _id: id, _type: "siteExpense", ref: await nextRef("expense"), ...set, createdAt: now, createdBy: "Payday" });
  } catch (error) {
    // Two payments saved at once both made it: bring the one there up to date instead.
    if ((error as { statusCode?: number }).statusCode !== 409) throw error;
    await client.patch(id).set(set).commit();
  }
  return hash;
}

/* ---------- steel bought against steel labour (lib/expenses/steel.ts) ---------- */

/** The steel benders' rate a ton bent and installed (GH₵ 2,000 unless changed on the steel page, /todo/steel). */
export async function steelRate(): Promise<number> {
  const rate = await getBuyersClient().fetch<number | null>(`*[_id == $id][0].steelRate`, { id: EXPENSE_SETTINGS_ID });
  return typeof rate === "number" && rate > 0 ? rate : STEEL_RATE;
}

/** The steel page's changes to the steel bought: an entry's tons (null: worked out again), or the rate a ton. */
export async function setSteel(body: Record<string, unknown>): Promise<{ rate: number; expense: Expense | null }> {
  const client = getBuyersClient();
  if ("rate" in body) {
    const rate = Number(body.rate);
    if (!(rate > 0 && rate < 1_000_000)) throw new TodoError(400, "Type the rate a ton in cedis, e.g. 2000.");
    await client.createIfNotExists({ _id: EXPENSE_SETTINGS_ID, _type: "expenseSettings" });
    await client.patch(EXPENSE_SETTINGS_ID).set({ steelRate: Math.round(rate * 100) / 100 }).commit();
  }
  let expense: Expense | null = null;
  if ("id" in body) {
    const id = body.id;
    if (!isId(EXPENSE_PREFIX, id)) throw new TodoError(404, "That entry isn't there any more.");
    const tons = body.tons === null || body.tons === "" ? null : Number(body.tons);
    if (tons !== null && !(tons >= 0 && tons < 10_000)) throw new TodoError(400, "Type the tons, e.g. 26 (0 for a part payment).");
    const patch = client.patch(id);
    await (tons === null ? patch.unset(["steelTons"]) : patch.set({ steelTons: Math.round(tons * 1000) / 1000 })).commit();
    expense = await getExpense(id);
  }
  return { rate: await steelRate(), expense };
}
