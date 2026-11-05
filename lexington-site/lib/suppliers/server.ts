import "server-only";
import { after } from "next/server";

import { listExpenses } from "@/lib/expenses/server";
import { FLOORS } from "@/lib/expenses/shared";
import { cleanOrderLink, orderUsed } from "@/lib/orders/link";
import { areasWith } from "@/lib/quickbooks/books";
import { cachedBookLists } from "@/lib/quickbooks/booksCache";
import { feedBill } from "@/lib/quickbooks/feed";
import { loadConnection } from "@/lib/quickbooks/store";
import { addVendor, cachedVendors, refreshVendors } from "@/lib/quickbooks/vendors";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BILL_COUNTER_ID, BILL_PREFIX, isId, newId } from "@/lib/site/ids";
import { ghanaDay } from "@/lib/store/shared";
import { cleanBillPhotoRef, cleanText, dropPhoto, photoRef, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { suppliersFrom, type Bill, type QboVendor, type SuppliersPage } from "./shared";

// Suppliers and their bills (lib/suppliers/shared.ts says what and why). The suppliers are QuickBooks' own; a bill is
// kept here (supplierBill, "bill-live-*") and goes into QuickBooks as a Bill (lib/quickbooks/feed.ts feedBill).

type Data = Record<string, unknown>;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const BILL_FIELDS = `{
  "id": _id,
  "appRef": appRef,
  vendorId,
  "supplier": coalesce(supplier, ""),
  date,
  "due": due,
  amount,
  "description": coalesce(description, ""),
  "ref": coalesce(ref, ""),
  "floor": floor,
  "costClass": costClass{ id, name },
  "photoUrl": photo.asset->url,
  "photoId": photo.asset._ref,
  "photoType": photo.asset->mimeType,
  createdAt,
  "createdBy": coalesce(createdBy, ""),
  "poId": poId,
  "qboTxnId": qbo.txnId,
  "qboError": qbo.error
}`;

export async function listBills(): Promise<Bill[]> {
  return getBuyersClient().fetch<Bill[]>(
    `*[_type == "supplierBill" && string::startsWith(_id, $prefix) && !coalesce(deleted, false)] | order(date desc, createdAt desc)[0...3000] ${BILL_FIELDS}`,
    { prefix: BILL_PREFIX }
  );
}

/** The suppliers page: QuickBooks' suppliers with what's owed and paid, every bill, and what the bill form offers. */
export async function suppliersPage(): Promise<SuppliersPage> {
  const [vendors, bills, expenses, books, conn] = await Promise.all([
    cachedVendors(),
    listBills(),
    listExpenses(),
    cachedBookLists().catch(() => ({ classes: [], locations: [], fetchedAt: null })),
    loadConnection().catch(() => null),
  ]);
  // A few minutes old: read again from QuickBooks for next time.
  after(() => refreshVendors());
  return {
    ...suppliersFrom(vendors.vendors, bills, expenses, ghanaDay()),
    fetchedAt: vendors.fetchedAt,
    areas: areasWith(FLOORS, books.locations).filter((a) => a !== "Whole building"),
    classes: books.classes,
    connected: conn?.status === "connected",
    payments: expenses.filter((x) => x.kind === "expense" && (x.supplier.trim() || x.billId)),
  };
}

/** The home page's figures: owed in all, how many bills are open, the next due and how many are overdue. */
export async function suppliersOwed(): Promise<{ owed: number; open: number; overdue: number; nextDue: string | null; suppliers: number }> {
  const [vendors, bills, expenses] = await Promise.all([cachedVendors(), listBills(), listExpenses()]);
  const data = suppliersFrom(vendors.vendors, bills, expenses, ghanaDay());
  const open = data.bills.filter((b) => b.left > 0);
  return {
    owed: data.owed,
    open: open.length,
    overdue: open.filter((b) => b.overdue).length,
    nextDue: open.map((b) => b.due).filter((d): d is string => !!d).sort()[0] ?? null,
    suppliers: new Set(open.map((b) => b.vendorId)).size,
  };
}

/* ---------- a bill ---------- */

function cleanDay(value: unknown, message: string): string {
  if (typeof value !== "string" || !DAY_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new TodoError(400, message);
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

/** BILL-0001, BILL-0002...: the app's own number for each bill (QuickBooks gets the supplier's number when there is one). */
async function nextBillRef(): Promise<string> {
  const client = getBuyersClient();
  await client.createIfNotExists({ _id: BILL_COUNTER_ID, _type: "billCounter", n: 0 });
  const doc = await client.patch(BILL_COUNTER_ID).setIfMissing({ n: 0 }).inc({ n: 1 }).commit<{ n: number }>();
  return `BILL-${String(doc.n).padStart(4, "0")}`;
}

/** A bill made or changed: who it's owed to (a QuickBooks supplier), when, how much, what for; it then goes into QuickBooks. */
export async function saveBill(me: TodoMe, body: Data): Promise<string> {
  const { vendors } = await cachedVendors();
  const vendor = vendors.find((v) => v.id === body.vendorId);
  if (!vendor) throw new TodoError(400, "Pick the supplier.");
  const date = cleanDay(body.date, "Pick the bill's date.");
  const due = body.due ? cleanDay(body.due, "Pick when it's to be paid.") : null;
  if (due && due < date) throw new TodoError(400, "It can't be due before its date.");
  const amount = Math.round(Number(String(body.amount ?? "").replace(/,/g, "")) * 100) / 100;
  if (!(amount > 0 && amount <= 50_000_000)) throw new TodoError(400, "Type the bill's amount, e.g. 12500.");
  const description = cleanText(body.description, 160, "description");
  if (!description) throw new TodoError(400, "Say what the bill is for, e.g. 3 tons of 16mm steel.");
  const ref = cleanText(body.ref, 40, "bill number");
  const areas = areasWith(FLOORS, (await cachedBookLists().catch(() => ({ locations: [] }))).locations);
  const floor = body.floor ? (typeof body.floor === "string" && areas.includes(body.floor) ? body.floor : null) : null;
  if (body.floor && !floor) throw new TodoError(400, "Pick the floor or stage again.");
  const costClass = cleanClass(body.costClass);
  const photoId = body.photoId === undefined ? undefined : cleanBillPhotoRef(body.photoId);
  const client = getBuyersClient();
  const now = new Date().toISOString();
  const fields = { vendorId: vendor.id, supplier: vendor.name, date, due, amount, description, ref, floor, costClass, updatedAt: now, updatedBy: me.name };

  let id: string;
  if (body.id !== undefined) {
    if (!isId(BILL_PREFIX, body.id)) throw new TodoError(404, "That bill isn't there any more.");
    id = body.id;
    const before = await client.fetch<{ photo?: string } | null>(`*[_id == $id && _type == "supplierBill" && !coalesce(deleted, false)][0]{ "photo": photo.asset._ref }`, { id });
    if (!before) throw new TodoError(404, "That bill isn't there any more.");
    let patch = client.patch(id).set(fields);
    if (photoId) patch = patch.set({ photo: photoRef(photoId) });
    if (photoId === null) patch = patch.unset(["photo"]);
    await patch.commit();
    if (photoId !== undefined && before.photo && before.photo !== photoId) await dropPhoto(before.photo, "bill");
  } else {
    // Made from a purchase order ("Make it a bill", lib/orders): bought on credit, so the order is placed.
    const poId = await cleanOrderLink(body.poId);
    id = newId(BILL_PREFIX);
    await client.create({
      _id: id,
      _type: "supplierBill",
      appRef: await nextBillRef(),
      ...fields,
      ...(poId ? { poId } : {}),
      ...(photoId ? { photo: photoRef(photoId) } : {}),
      createdAt: now,
      createdBy: me.name,
    });
    if (poId) await orderUsed(me, poId);
  }
  after(() => feedBill(id));
  return id;
}

/** A bill taken off: only while nothing has paid it (QuickBooks keeps it until it's removed there by hand). */
export async function deleteBill(me: TodoMe, id: unknown): Promise<void> {
  if (!isId(BILL_PREFIX, id)) throw new TodoError(404, "That bill isn't there any more.");
  const client = getBuyersClient();
  const payments = await client.fetch<number>(`count(*[_type == "siteExpense" && billId == $id])`, { id });
  if (payments > 0) throw new TodoError(409, "Something has paid this bill: take that payment off the bill first (in Expenses), then delete it.");
  await client.patch(id).set({ deleted: true, deletedAt: new Date().toISOString(), deletedBy: me.name }).commit();
  after(() => feedBill(id));
}

/** A new supplier: made in QuickBooks (so both lists match), then on the list. */
export async function newSupplier(body: Data): Promise<QboVendor> {
  const name = cleanText(body.name, 100, "name").replace(/\s+/g, " ");
  if (!name) throw new TodoError(400, "Type the supplier's name.");
  const phone = cleanText(body.phone, 30, "phone");
  const { vendors } = await cachedVendors();
  const same = vendors.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (same) throw new TodoError(409, `"${same.name}" is on the list already.`);
  try {
    return await addVendor(name, phone);
  } catch (error) {
    throw new TodoError(502, error instanceof Error ? error.message : "QuickBooks didn't take it. Try again.");
  }
}
