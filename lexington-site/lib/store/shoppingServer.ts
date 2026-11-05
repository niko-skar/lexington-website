import "server-only";

import { notifyOwner } from "@/lib/alerts/notify";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BUY_PREFIX, isId, ITEM_PREFIX, newId, TOOL_PREFIX } from "@/lib/site/ids";
import { cleanPhotoRef, cleanText, dropPhoto, photoRef, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { categoryOf } from "./categories";
import { getItem } from "./server";
import { atReorderPoint, type StoreItem } from "./shared";
import { buyQty, guessBuyGroup, isBuyGroup, MAX_BUY_NAME, MAX_BUY_NOTE, MAX_BUY_UNIT, type StoreBuy } from "./shopping";
import { getTool } from "./tools";

// The shopping list's own lines (lib/store/shopping.ts): anyone using the store adds to it (Albert, the storekeeper,
// the office), and anyone ticks what they bought. Whoever added a line can change it or take it off while it's to buy;
// the office can do anything. A site login's "needed today" buzzes the office's phone.

export const BUY_FIELDS = `{
  "id": _id,
  "name": coalesce(name, ""),
  "qty": qty,
  "unit": coalesce(unit, ""),
  "note": coalesce(note, ""),
  "photoUrl": photo.asset->url,
  "category": category,
  "itemId": itemId,
  "toolId": toolId,
  "urgent": coalesce(urgent, false),
  at,
  "by": coalesce(by, ""),
  byId,
  "gotAt": gotAt,
  "gotBy": gotBy
}`;
export type RawBuy = Omit<StoreBuy, "mine" | "category"> & { category?: string | null; byId?: string };

export const toBuy = (me: TodoMe, { byId, ...raw }: RawBuy): StoreBuy => ({
  ...raw,
  qty: typeof raw.qty === "number" ? raw.qty : null,
  itemId: raw.itemId ?? null,
  toolId: raw.toolId ?? null,
  gotAt: raw.gotAt ?? null,
  gotBy: raw.gotBy ?? null,
  category: isBuyGroup(raw.category) ? raw.category : guessBuyGroup(raw.name),
  mine: !!byId && byId === me.id,
});

const GONE = "That isn't on the shopping list any more. Refresh the page.";
const LIST_LINK = "/todo/store#buy";

async function readBuy(me: TodoMe, id: string): Promise<StoreBuy | null> {
  const raw = await getBuyersClient().fetch<RawBuy | null>(`*[_id == $id && _type == "storeBuy"][0] ${BUY_FIELDS}`, { id });
  return raw ? toBuy(me, raw) : null;
}

function cleanName(value: unknown) {
  const name = cleanText(value, MAX_BUY_NAME, "name").replace(/\s+/g, " ");
  if (!name) throw new TodoError(400, "Type what's needed, e.g. Cement 50kg.");
  return name;
}
/** How many: a number above 0, or null when it isn't said. */
function cleanBuyQty(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new TodoError(400, "Type how many as a number, or leave it empty.");
  return Math.round(n * 1000) / 1000;
}
const cleanUnit = (value: unknown) => cleanText(value, MAX_BUY_UNIT, "unit").replace(/\s+/g, " ").toLowerCase();

/** The line in a phone alert: "Needed today: 2 bags Cement". */
const alertTitle = (name: string, qty: number | null, unit: string) => `Needed today: ${qty === null ? "" : `${buyQty(qty, unit)} `}${name}`;

/**
 * Something onto the shopping list: { name, qty?, unit?, note?, photoId?, category?, itemId? | toolId?, urgent? }.
 * Anyone using the store. More of a store item or a tool says which (its unit and heading come with it).
 */
export async function createBuy(me: TodoMe, body: Record<string, unknown>): Promise<StoreBuy> {
  const client = getBuyersClient();
  let item: StoreItem | null = null;
  let toolName: string | null = null;
  if (body.itemId !== undefined && body.itemId !== null && body.itemId !== "") {
    if (!isId(ITEM_PREFIX, body.itemId)) throw new TodoError(404, "That item isn't in the store any more.");
    item = await getItem(body.itemId);
    if (!item) throw new TodoError(404, "That item isn't in the store any more.");
  } else if (body.toolId !== undefined && body.toolId !== null && body.toolId !== "") {
    if (!isId(TOOL_PREFIX, body.toolId)) throw new TodoError(404, "That tool isn't on the list any more.");
    const tool = await getTool(body.toolId);
    if (!tool) throw new TodoError(404, "That tool isn't on the list any more.");
    toolName = tool.name;
  }
  const itemId = item?.id ?? null;
  const toolId = toolName ? (body.toolId as string) : null;
  const name = body.name === undefined || body.name === null || body.name === "" ? (item?.name ?? toolName ?? cleanName(body.name)) : cleanName(body.name);
  const qty = cleanBuyQty(body.qty);
  const unit = cleanUnit(body.unit) || (item && qty !== null ? item.unit : "");
  const note = cleanText(body.note, MAX_BUY_NOTE, "note");
  const photoId = cleanPhotoRef(body.photoId);
  const category = isBuyGroup(body.category) ? body.category : item ? categoryOf(item) : toolId ? "Tools" : guessBuyGroup(name);
  const urgent = body.urgent === true;

  // The same item or tool twice (a double tap, or two people at once): once, with how many said there.
  if (itemId || toolId) {
    const there = await client.fetch<{ name: string } | null>(
      `*[_type == "storeBuy" && string::startsWith(_id, $prefix) && !defined(gotAt) && (($item != null && itemId == $item) || ($tool != null && toolId == $tool))][0]{ name }`,
      { prefix: BUY_PREFIX, item: itemId, tool: toolId }
    );
    if (there) throw new TodoError(409, `${there.name} is on the shopping list already: change how many there.`);
  }

  const id = newId(BUY_PREFIX);
  const at = new Date().toISOString();
  await client.create({
    _id: id,
    _type: "storeBuy",
    name,
    ...(qty !== null ? { qty } : {}),
    ...(unit ? { unit } : {}),
    note,
    ...(photoId ? { photo: photoRef(photoId) } : {}),
    category,
    ...(itemId ? { itemId } : {}),
    ...(toolId ? { toolId } : {}),
    urgent,
    at,
    by: me.name,
    byId: me.id,
  });
  // Niko adds his own; a site login's "needed today" reaches him.
  if (urgent && me.kind !== "admin") {
    await notifyOwner({
      kind: "store",
      title: alertTitle(name, qty, unit),
      lines: [`Added to the shopping list by ${me.name}`, ...(note ? [`Note: ${note}`] : [])],
      links: [{ label: "Open the shopping list", url: LIST_LINK }],
      urgent: true,
      tag: id,
      open: LIST_LINK,
    });
  }
  const buy = await readBuy(me, id);
  if (!buy) throw new TodoError(502, "It was saved but couldn't be read back. Refresh the page.");
  return buy;
}

/** A store item ticked as bought at its reorder point, or back to buy: { item } as it is now. */
async function markItem(me: TodoMe, itemId: string, got: boolean): Promise<StoreItem | null> {
  const item = await getItem(itemId);
  if (!item) return null;
  if (got && !atReorderPoint(item)) return item;
  if (!got && !item.reorderGot) return item;
  const patch = getBuyersClient().patch(itemId);
  await (got ? patch.set({ reorderGot: { at: new Date().toISOString(), by: me.name, byId: me.id } }) : patch.unset(["reorderGot"])).commit();
  return getItem(itemId);
}

/**
 * A line moved on, or changed:
 *   { action: "got" }   bought (anyone using the store); a store item at its reorder point is ticked with it
 *   { action: "back" }  not bought after all: to buy again
 *   { name?, qty?, unit?, note?, category?, urgent?, photoId? }  changed (the office; whoever added it, while to buy)
 * Answers { buy, item? } (the store item it's more of, when its tick changed).
 */
export async function changeBuy(me: TodoMe, id: string, body: Record<string, unknown>): Promise<{ buy: StoreBuy; item?: StoreItem }> {
  if (!isId(BUY_PREFIX, id)) throw new TodoError(404, GONE);
  const client = getBuyersClient();
  const doc = await client.fetch<{ name: string; qty?: number; unit?: string; byId?: string; gotAt?: string; itemId?: string; urgent?: boolean; photo?: string } | null>(
    `*[_id == $id && _type == "storeBuy"][0]{ name, qty, unit, byId, gotAt, itemId, urgent, "photo": photo.asset._ref }`,
    { id }
  );
  if (!doc) throw new TodoError(404, GONE);

  if (body.action === "got" || body.action === "back") {
    const got = body.action === "got";
    if (got && doc.gotAt) return { buy: (await readBuy(me, id))! };
    if (!got && !doc.gotAt) return { buy: (await readBuy(me, id))! };
    const patch = client.patch(id);
    await (got ? patch.set({ gotAt: new Date().toISOString(), gotBy: me.name, gotById: me.id }) : patch.unset(["gotAt", "gotBy", "gotById"])).commit();
    const item = doc.itemId ? await markItem(me, doc.itemId, got) : null;
    const buy = await readBuy(me, id);
    if (!buy) throw new TodoError(404, GONE);
    return { buy, ...(item ? { item } : {}) };
  }

  if (me.kind !== "admin") {
    if (doc.byId !== me.id) throw new TodoError(403, "Only the office can change what someone else added.");
    if (doc.gotAt) throw new TodoError(403, "It's been bought already. Ask the office to change it.");
  }
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  if ("name" in body) set.name = cleanName(body.name);
  if ("qty" in body) {
    const qty = cleanBuyQty(body.qty);
    if (qty === null) unset.push("qty");
    else set.qty = qty;
  }
  if ("unit" in body) {
    const unit = cleanUnit(body.unit);
    if (unit) set.unit = unit;
    else unset.push("unit");
  }
  if ("note" in body) set.note = cleanText(body.note, MAX_BUY_NOTE, "note");
  if ("category" in body) {
    if (!isBuyGroup(body.category)) throw new TodoError(400, "Pick one of the headings.");
    set.category = body.category;
  }
  if ("urgent" in body) set.urgent = body.urgent === true;
  let newPhoto: string | null = null;
  if ("photoId" in body) {
    newPhoto = cleanPhotoRef(body.photoId);
    if (newPhoto) set.photo = photoRef(newPhoto);
    else unset.push("photo");
  }
  if (Object.keys(set).length || unset.length) {
    let patch = client.patch(id);
    if (Object.keys(set).length) patch = patch.set(set);
    if (unset.length) patch = patch.unset(unset);
    await patch.commit();
  }
  if ("photoId" in body && doc.photo && doc.photo !== newPhoto) await dropPhoto(doc.photo, "store");
  const buy = await readBuy(me, id);
  if (!buy) throw new TodoError(404, GONE);
  // Made "needed today" by a site login: it reaches the office now.
  if (set.urgent === true && !doc.urgent && !buy.gotAt && me.kind !== "admin") {
    await notifyOwner({
      kind: "store",
      title: alertTitle(buy.name, buy.qty, buy.unit),
      lines: [`On the shopping list, marked by ${me.name}`, ...(buy.note ? [`Note: ${buy.note}`] : [])],
      links: [{ label: "Open the shopping list", url: LIST_LINK }],
      urgent: true,
      tag: id,
      open: LIST_LINK,
    });
  }
  return { buy };
}

/** Off the list for good: the office any time; whoever added it while it's still to buy. */
export async function deleteBuy(me: TodoMe, id: string): Promise<void> {
  if (!isId(BUY_PREFIX, id)) throw new TodoError(404, GONE);
  const client = getBuyersClient();
  const doc = await client.fetch<{ byId?: string; gotAt?: string; photo?: string } | null>(`*[_id == $id && _type == "storeBuy"][0]{ byId, gotAt, "photo": photo.asset._ref }`, { id });
  if (!doc) return;
  if (me.kind !== "admin") {
    if (doc.byId !== me.id) throw new TodoError(403, "Only the office can take off what someone else added.");
    if (doc.gotAt) throw new TodoError(403, "It's been bought already. Ask the office to take it off.");
  }
  await client.delete(id);
  if (doc.photo) await dropPhoto(doc.photo, "store");
}

/** A store item at its reorder point ticked as bought ({ got: true }), or back to buy: anyone using the store. */
export async function setReorderGot(me: TodoMe, body: Record<string, unknown>): Promise<{ item: StoreItem }> {
  if (!isId(ITEM_PREFIX, body.itemId)) throw new TodoError(404, "That item isn't in the store any more.");
  const item = await markItem(me, body.itemId, body.got === true);
  if (!item) throw new TodoError(404, "That item isn't in the store any more.");
  return { item };
}
