import "server-only";
import { randomBytes } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { EXPENSE_PREFIX, isId, newId } from "@/lib/site/ids";
import { itemForPurchase } from "@/lib/store/server";
import { cleanText, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import {
  CATEGORIES,
  FLOORS,
  FOR_WHO,
  MAX_DESCRIPTION,
  MAX_MATERIAL,
  MAX_SUPPLIER,
  METHODS,
  todayISO,
  type Expense,
} from "./shared";

// Sanity asset ids: image-<sha1>-<width>x<height>-<format>, file-<sha1>-<extension>.
const RECEIPT_ID_RE = /^(image-[a-f0-9]{40}-\d+x\d+-(jpg|png|webp)|file-[a-f0-9]{40}-pdf)$/;

const FIELDS = `{
  "id": _id,
  date,
  "kind": coalesce(kind, "expense"),
  "forWho": coalesce(forWho, "Site"),
  amount,
  "supplier": coalesce(supplier, ""),
  "description": coalesce(description, ""),
  "floor": floor,
  "method": method,
  "category": category,
  "material": material,
  "qty": qty,
  "itemId": itemId,
  "toStore": coalesce(toStore, false),
  "receiptId": receipt.asset._ref,
  "receiptUrl": receipt.asset->url,
  "receiptType": receipt.asset->mimeType,
  createdAt,
  "createdBy": coalesce(createdBy, ""),
  "updatedAt": _updatedAt
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
async function fields(me: TodoMe, body: Record<string, unknown>) {
  const kind = body.kind === "inflow" ? "inflow" : "expense";
  const inflow = kind === "inflow";
  const forWho = pick(body.forWho ?? "Site", FOR_WHO, "Pick who it's for: Site, House, Niko or Event.");
  const amount = Math.round(cleanNumber(body.amount, inflow ? "Enter the amount received." : "Enter the amount paid.") * 100) / 100;
  const method = pick(body.method, METHODS, inflow ? "Pick how the money came in." : "Pick how it was paid.");
  const category = inflow ? null : pick(body.category, CATEGORIES, "Pick Material, Service or Other.");
  const floor = inflow || forWho !== "Site" ? null : pick(body.floor, FLOORS, "Pick the floor or area.");
  let material: string | null = null;
  let qty: number | null = null;
  let itemId: string | null = null;
  let toStore = false;
  if (category === "Material") {
    material = cleanText(body.material, MAX_MATERIAL, "material").replace(/\s+/g, " ");
    if (!material) throw new TodoError(400, "Write which material you bought.");
    qty = Math.round(cleanNumber(body.qty ?? 1, "Pick how many.") * 1000) / 1000;
    if (body.toStore === true) {
      const item = await itemForPurchase(me, material, body.unit);
      itemId = item.id;
      material = item.name;
      toStore = true;
    }
  }
  return {
    date: cleanDate(body.date),
    kind,
    forWho,
    amount,
    supplier: cleanText(body.supplier, MAX_SUPPLIER, "supplier"),
    description: cleanText(body.description, MAX_DESCRIPTION, "description"),
    floor,
    method,
    category,
    material,
    qty,
    itemId,
    toStore,
  };
}

const receiptRef = (assetId: string) => ({
  _type: assetId.startsWith("file-") ? "file" : "image",
  asset: { _type: "reference", _ref: assetId },
});

/* ---------- saving ---------- */

export async function createExpense(me: TodoMe, body: Record<string, unknown>): Promise<Expense> {
  const receiptId = cleanReceiptId(body.receiptId);
  const id = newId(EXPENSE_PREFIX);
  await getBuyersClient().create({
    _id: id,
    _type: "siteExpense",
    ...(await fields(me, body)),
    ...(receiptId ? { receipt: receiptRef(receiptId) } : {}),
    createdAt: new Date().toISOString(),
    createdBy: me.name,
  });
  const expense = await getExpense(id);
  if (!expense) throw new TodoError(502, "It was saved but couldn't be read back. Refresh the page.");
  return expense;
}

export async function updateExpense(me: TodoMe, id: string, body: Record<string, unknown>): Promise<Expense> {
  if (!isId(EXPENSE_PREFIX, id)) throw new TodoError(404, "That entry isn't there any more.");
  const client = getBuyersClient();
  const before = await client.fetch<{ receipt?: string } | null>(`*[_id == $id && _type == "siteExpense"][0]{ "receipt": receipt.asset._ref }`, { id });
  if (!before) throw new TodoError(404, "That entry isn't there any more.");
  const receiptId = cleanReceiptId(body.receiptId);
  const set = { ...(await fields(me, body)), updatedBy: me.name, ...(receiptId ? { receipt: receiptRef(receiptId) } : {}) };
  const patch = client.patch(id).set(set);
  await (receiptId ? patch : patch.unset(["receipt"])).commit();
  if (before.receipt && before.receipt !== receiptId) await dropReceipt(before.receipt);
  const expense = await getExpense(id);
  if (!expense) throw new TodoError(404, "That entry isn't there any more.");
  return expense;
}

export async function deleteExpense(id: string): Promise<void> {
  if (!isId(EXPENSE_PREFIX, id)) throw new TodoError(404, "That entry isn't there any more.");
  const client = getBuyersClient();
  const before = await client.fetch<{ receipt?: string } | null>(`*[_id == $id && _type == "siteExpense"][0]{ "receipt": receipt.asset._ref }`, { id });
  if (!before) return;
  await client.delete(id);
  if (before.receipt) await dropReceipt(before.receipt);
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
