import "server-only";

import { FLOORS } from "@/lib/expenses/shared";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { CHECK_PREFIX, EXPENSE_PREFIX, isId, ITEM_PREFIX, MOVE_PREFIX, newId, TOOL_OUT_PREFIX, TOOL_PREFIX } from "@/lib/site/ids";
import { cleanPhotoRef, cleanText, dropPhoto, photoRef, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { CHECK_FIELDS, toCheck, type RawCheck } from "./checks";
import {
  MAX_ITEM_NAME,
  MAX_MOVE_NOTE,
  MAX_PERSON,
  MAX_UNIT,
  UNDO_MINUTES,
  type MoveKind,
  type StoreData,
  type StoreEntry,
  type StoreItem,
  type StoreTool,
} from "./shared";
import { OUT_FIELDS, TOOL_FIELDS, toOut, type RawOut } from "./tools";

// The stock is never stored: it is always added up from what moved, so correcting or deleting a
// purchase (in the expenses) or a wrong take-out puts the number right by itself.
//   bought   -- paid Material expenses marked "into the store room"
//   in       -- stock the office adds by hand (e.g. bought before the store existed)
//   back     -- brought back to the store
//   out      -- taken out (always with a photo of what went)
//   count    -- a count: the difference between the shelf and the record at that moment

type Totals = { bought: number; added: number; back: number; taken: number; adjusted: number };
type RawItem = Omit<StoreItem, "level"> & Totals;
type RawMove = Omit<StoreEntry, "mine"> & { byId?: string };

const ITEM_FIELDS = `{
  "id": _id,
  "name": coalesce(name, ""),
  "unit": coalesce(unit, "pcs"),
  "stocked": coalesce(stocked, true),
  "low": low,
  "reorderQty": reorderQty,
  "reorderDismissed": coalesce(reorderDismissed, false),
  "photoUrl": photo.asset->url,
  "bought": coalesce(math::sum(*[_type == "siteExpense" && string::startsWith(_id, $expensePrefix) && itemId == ^._id && toStore == true].qty), 0),
  "added": coalesce(math::sum(*[_type == "storeMove" && itemId == ^._id && kind == "in"].qty), 0),
  "back": coalesce(math::sum(*[_type == "storeMove" && itemId == ^._id && kind == "back"].qty), 0),
  "taken": coalesce(math::sum(*[_type == "storeMove" && itemId == ^._id && kind == "out"].qty), 0),
  "adjusted": coalesce(math::sum(*[_type == "storeMove" && itemId == ^._id && kind == "count"].diff), 0),
  "lastCountAt": *[_type == "storeMove" && itemId == ^._id && kind == "count"] | order(at desc)[0].at
}`;
const MOVE_FIELDS = `{
  "id": _id, kind, itemId, qty, "diff": diff, "opening": coalesce(opening, false), "floor": floor, "person": person,
  "note": coalesce(note, ""), "photoUrl": photo.asset->url, at, "by": coalesce(by, ""), byId
}`;
const BOUGHT_FIELDS = `{
  "id": _id, "kind": "bought", itemId, qty, "diff": null, "floor": floor, "person": null, "note": "", "photoUrl": null, date,
  "at": createdAt, "by": coalesce(createdBy, ""), supplier, amount
}`;
const params = { itemPrefix: ITEM_PREFIX, movePrefix: MOVE_PREFIX, expensePrefix: EXPENSE_PREFIX };

const round = (n: number) => Math.round(n * 1000) / 1000;

function withLevel({ bought, added, back, taken, adjusted, ...item }: RawItem): StoreItem {
  return { ...item, level: round(bought + added + back - taken + adjusted) };
}

/** A site login never sees what was paid or to whom. */
function toEntry(me: TodoMe, { byId, ...raw }: RawMove): StoreEntry {
  const entry: StoreEntry = { ...raw, mine: !!byId && byId === me.id };
  if (me.kind !== "admin") {
    delete entry.supplier;
    delete entry.amount;
  }
  return entry;
}

/** Moves and purchases, newest first, as far back as both lists reach. */
function history(me: TodoMe, moves: RawMove[], bought: RawMove[], moveCap: number, boughtCap: number): StoreEntry[] {
  const reach = [moves.length === moveCap ? moves[moves.length - 1]?.at : "", bought.length === boughtCap ? bought[bought.length - 1]?.at : ""]
    .filter(Boolean)
    .sort()
    .pop();
  return [...moves, ...bought]
    .filter((e) => e.at && (!reach || e.at >= reach))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e) => toEntry(me, e));
}

/** "No need to reorder" lasts until the item is restocked above its reorder point. */
async function clearStaleDismissals(items: StoreItem[]): Promise<void> {
  const stale = items.filter((i) => i.reorderDismissed && (i.low === null || i.level > i.low));
  if (!stale.length) return;
  const tx = getBuyersClient().transaction();
  for (const i of stale) tx.patch(i.id, (p) => p.set({ reorderDismissed: false }));
  try {
    await tx.commit();
    for (const i of stale) i.reorderDismissed = false;
  } catch (error) {
    console.error("[store] clearing reorder dismissals failed:", error instanceof Error ? error.message : error);
  }
}

/* ---------- reading ---------- */

/**
 * The whole store room in one look: stock, what moved, the tools with every take-out still open
 * (and the last week's), and the last month of opening and closing photos.
 */
export async function getStore(me: TodoMe): Promise<StoreData> {
  const day = 86_400_000;
  const data = await getBuyersClient().fetch<{
    items: RawItem[];
    moves: RawMove[];
    bought: RawMove[];
    tools: StoreTool[];
    outsOpen: RawOut[];
    outsDone: RawOut[];
    checks: RawCheck[];
  }>(
    `{
      "items": *[_type == "storeItem" && string::startsWith(_id, $itemPrefix)] | order(lower(name) asc) ${ITEM_FIELDS},
      "moves": *[_type == "storeMove" && string::startsWith(_id, $movePrefix)] | order(at desc)[0...200] ${MOVE_FIELDS},
      "bought": *[_type == "siteExpense" && string::startsWith(_id, $expensePrefix) && toStore == true && defined(itemId)] | order(createdAt desc)[0...100] ${BOUGHT_FIELDS},
      "tools": *[_type == "storeTool" && string::startsWith(_id, $toolPrefix)] | order(lower(name) asc) ${TOOL_FIELDS},
      "outsOpen": *[_type == "toolOut" && string::startsWith(_id, $outPrefix) && !defined(closedAt)] | order(at desc)[0...500] ${OUT_FIELDS},
      "outsDone": *[_type == "toolOut" && string::startsWith(_id, $outPrefix) && defined(closedAt) && at >= $weekAgo] | order(at desc)[0...300] ${OUT_FIELDS},
      "checks": *[_type == "storeCheck" && string::startsWith(_id, $checkPrefix) && at >= $monthAgo] | order(at desc)[0...200] ${CHECK_FIELDS}
    }`,
    {
      ...params,
      toolPrefix: TOOL_PREFIX,
      outPrefix: TOOL_OUT_PREFIX,
      checkPrefix: CHECK_PREFIX,
      weekAgo: new Date(Date.now() - 8 * day).toISOString(),
      monthAgo: new Date(Date.now() - 31 * day).toISOString(),
    }
  );
  const items = data.items.map(withLevel);
  await clearStaleDismissals(items);
  return {
    items,
    history: history(me, data.moves, data.bought, 200, 100),
    tools: data.tools,
    toolOuts: [...data.outsOpen, ...data.outsDone].sort((a, b) => b.at.localeCompare(a.at)).map((o) => toOut(me, o)),
    checks: data.checks.map((c) => toCheck(me, c)),
  };
}

async function getItem(id: string): Promise<StoreItem | null> {
  const raw = await getBuyersClient().fetch<RawItem | null>(`*[_id == $id && _type == "storeItem"][0] ${ITEM_FIELDS}`, { ...params, id });
  return raw ? withLevel(raw) : null;
}

/** Everything that ever moved for one item. */
export async function itemHistory(me: TodoMe, id: string): Promise<{ item: StoreItem; history: StoreEntry[] }> {
  if (!isId(ITEM_PREFIX, id)) throw new TodoError(404, "That item isn't in the store any more.");
  const data = await getBuyersClient().fetch<{ item: RawItem | null; moves: RawMove[]; bought: RawMove[] }>(
    `{
      "item": *[_id == $id && _type == "storeItem"][0] ${ITEM_FIELDS},
      "moves": *[_type == "storeMove" && itemId == $id] | order(at desc)[0...1000] ${MOVE_FIELDS},
      "bought": *[_type == "siteExpense" && string::startsWith(_id, $expensePrefix) && itemId == $id && toStore == true] | order(createdAt desc)[0...1000] ${BOUGHT_FIELDS}
    }`,
    { ...params, id }
  );
  if (!data.item) throw new TodoError(404, "That item isn't in the store any more.");
  return { item: withLevel(data.item), history: history(me, data.moves, data.bought, 1000, 1000) };
}

/* ---------- items ---------- */

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

function cleanName(value: unknown) {
  const name = cleanText(value, MAX_ITEM_NAME, "name").replace(/\s+/g, " ");
  if (!name) throw new TodoError(400, "Type what it is, e.g. Cement 50kg.");
  return name;
}
function cleanUnit(value: unknown) {
  return cleanText(value, MAX_UNIT, "unit").replace(/\s+/g, " ").toLowerCase() || "pcs";
}
function cleanQty(value: unknown, zeroOk: boolean, message?: string) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || (!zeroOk && n === 0) || n > 1_000_000) {
    throw new TodoError(400, message ?? (zeroOk ? "Type how many are there (0 if none)." : "Type how many."));
  }
  return round(n);
}
function cleanOptionalQty(value: unknown, message: string) {
  return value === null || value === undefined || value === "" ? null : cleanQty(value, true, message);
}
function cleanFloor(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !(FLOORS as readonly string[]).includes(value)) throw new TodoError(400, "Pick a floor from the list.");
  return value;
}

/** An item by its name or a name it had before (so old names still find it). */
async function findItem(name: string): Promise<{ id: string; stocked: boolean } | null> {
  return getBuyersClient().fetch(
    `*[_type == "storeItem" && string::startsWith(_id, $prefix) && (lower(name) == $key || $key in aliases)][0]{ "id": _id, "stocked": coalesce(stocked, true) }`,
    { prefix: ITEM_PREFIX, key: key(name) }
  );
}

async function createItemDoc(me: TodoMe, name: string, unit: string, photoId: string | null = null): Promise<string> {
  const id = newId(ITEM_PREFIX);
  await getBuyersClient().create({
    _id: id,
    _type: "storeItem",
    name,
    unit,
    stocked: true,
    ...(photoId ? { photo: photoRef(photoId) } : {}),
    createdAt: new Date().toISOString(),
    createdBy: me.name,
  });
  return id;
}

/**
 * The item a paid Material purchase adds stock to: the one with that name (or an old name of it),
 * else a new one. Buying something again that was set "not kept in the store" puts it back.
 */
export async function itemForPurchase(me: TodoMe, material: string, unit: unknown): Promise<{ id: string; name: string }> {
  const found = await findItem(material);
  if (found) {
    const client = getBuyersClient();
    if (!found.stocked) await client.patch(found.id).set({ stocked: true }).commit();
    const name = await client.fetch<string>(`*[_id == $id][0].name`, { id: found.id });
    return { id: found.id, name: name || material };
  }
  const name = cleanName(material);
  return { id: await createItemDoc(me, name, cleanUnit(unit)), name };
}

/** A new item, with what is on the shelf now (its starting count) and a photo of it. Anyone who uses the store. */
export async function createItem(me: TodoMe, body: Record<string, unknown>): Promise<StoreItem> {
  const name = cleanName(body.name);
  const unit = cleanUnit(body.unit);
  const count = cleanOptionalQty(body.count, "Type how many are there now (0 if none).");
  const photoId = cleanPhotoRef(body.photoId);
  if (await findItem(name)) throw new TodoError(409, `"${name}" is already in the store. Find it in the list and count it there.`);
  const id = await createItemDoc(me, name, unit, photoId);
  if (count !== null) {
    await getBuyersClient().create({
      _id: newId(MOVE_PREFIX),
      _type: "storeMove",
      itemId: id,
      kind: "count",
      qty: count,
      diff: count,
      opening: true,
      note: "",
      at: new Date().toISOString(),
      by: me.name,
      byId: me.id,
    });
  }
  const item = await getItem(id);
  if (!item) throw new TodoError(502, "It was saved but couldn't be read back. Refresh the page.");
  return item;
}

/** A new photo of an item's stock. Anyone who uses the store. */
export async function setItemPhoto(id: string, value: unknown): Promise<StoreItem> {
  if (!isId(ITEM_PREFIX, id)) throw new TodoError(404, "That item isn't in the store any more.");
  const photoId = cleanPhotoRef(value);
  if (!photoId) throw new TodoError(400, "Take a photo first.");
  const client = getBuyersClient();
  const before = await client.fetch<{ photo?: string } | null>(`*[_id == $id && _type == "storeItem"][0]{ "photo": photo.asset._ref }`, { id });
  if (!before) throw new TodoError(404, "That item isn't in the store any more.");
  await client.patch(id).set({ photo: photoRef(photoId) }).commit();
  if (before.photo && before.photo !== photoId) await dropPhoto(before.photo, "store");
  const item = await getItem(id);
  if (!item) throw new TodoError(404, "That item isn't in the store any more.");
  return item;
}

/** The office: rename, unit, reorder point and quantity, dismiss a reorder, or stop keeping it in the store. */
export async function updateItem(id: string, body: Record<string, unknown>): Promise<StoreItem> {
  if (!isId(ITEM_PREFIX, id)) throw new TodoError(404, "That item isn't in the store any more.");
  const client = getBuyersClient();
  const before = await client.fetch<{ name: string; aliases?: string[] } | null>(`*[_id == $id && _type == "storeItem"][0]{ name, aliases }`, { id });
  if (!before) throw new TodoError(404, "That item isn't in the store any more.");
  const set: Record<string, unknown> = {};
  if ("name" in body) {
    const name = cleanName(body.name);
    if (key(name) !== key(before.name)) {
      const clash = await findItem(name);
      if (clash && clash.id !== id) throw new TodoError(409, `There's already "${name}" in the store.`);
      set.name = name;
      // Purchases typed with the old name still land on this item.
      set.aliases = Array.from(new Set([...(before.aliases ?? []), key(before.name)])).filter((a) => a !== key(name));
    }
  }
  if ("unit" in body) set.unit = cleanUnit(body.unit);
  if ("low" in body) set.low = cleanOptionalQty(body.low, "Type the reorder point as a number, or leave it empty.");
  if ("reorderQty" in body) set.reorderQty = cleanOptionalQty(body.reorderQty, "Type how much to reorder as a number, or leave it empty.");
  if ("reorderDismissed" in body) {
    set.reorderDismissed = body.reorderDismissed === true;
    set.reorderDismissedAt = body.reorderDismissed === true ? new Date().toISOString() : null;
  }
  if ("stocked" in body) set.stocked = body.stocked !== false;
  if (Object.keys(set).length) await client.patch(id).set(set).commit();
  const item = await getItem(id);
  if (!item) throw new TodoError(404, "That item isn't in the store any more.");
  return item;
}

/* ---------- moves ---------- */

const KINDS: MoveKind[] = ["out", "back", "in", "count"];

export async function addMove(me: TodoMe, body: Record<string, unknown>): Promise<{ item: StoreItem; entry: StoreEntry }> {
  const kind = body.kind as MoveKind;
  if (!KINDS.includes(kind)) throw new TodoError(400, "Unknown change.");
  if (kind === "in" && me.kind !== "admin") throw new TodoError(403, "Only the office adds stock by hand. Purchases go in with the expense.");
  const itemId = body.itemId;
  if (!isId(ITEM_PREFIX, itemId)) throw new TodoError(404, "That item isn't in the store any more.");
  const qty = cleanQty(body.qty, kind === "count");
  const moving = kind === "out" || kind === "back";
  const floor = moving ? cleanFloor(body.floor) : null;
  const person = moving ? cleanText(body.person, MAX_PERSON, "name") || null : null;
  const note = cleanText(body.note, MAX_MOVE_NOTE, "note");
  const photoId = cleanPhotoRef(body.photoId);
  // Niko, 23 Oct 2026: "any stock movements require a photo of the stock going out".
  if (kind === "out" && !photoId) throw new TodoError(400, "Take a photo of what's going out first.");
  const item = await getItem(itemId);
  if (!item) throw new TodoError(404, "That item isn't in the store any more.");

  const doc = {
    _id: newId(MOVE_PREFIX),
    _type: "storeMove",
    itemId,
    kind,
    qty,
    ...(kind === "count" ? { diff: round(qty - item.level) } : {}),
    ...(floor ? { floor } : {}),
    ...(person ? { person } : {}),
    ...(photoId ? { photo: photoRef(photoId) } : {}),
    note,
    at: new Date().toISOString(),
    by: me.name,
    byId: me.id,
  };
  const created = await getBuyersClient().create(doc);
  const [after, saved] = await Promise.all([
    getItem(itemId),
    getBuyersClient().fetch<RawMove | null>(`*[_id == $id][0] ${MOVE_FIELDS}`, { id: created._id }),
  ]);
  if (!after || !saved) throw new TodoError(404, "That item isn't in the store any more.");
  return { item: after, entry: toEntry(me, saved) };
}

/** Undo a wrong entry: the office any time; a site login its own, for a few minutes. */
export async function deleteMove(me: TodoMe, id: string): Promise<StoreItem | null> {
  if (!isId(MOVE_PREFIX, id)) throw new TodoError(404, "That entry isn't there any more.");
  const client = getBuyersClient();
  const move = await client.fetch<{ byId?: string; at: string; itemId: string; photo?: string } | null>(
    `*[_id == $id && _type == "storeMove"][0]{ byId, at, itemId, "photo": photo.asset._ref }`,
    { id }
  );
  if (!move) return null;
  if (me.kind !== "admin") {
    if (move.byId !== me.id) throw new TodoError(403, "Only the office can remove what someone else recorded.");
    if (Date.now() - Date.parse(move.at) > UNDO_MINUTES * 60_000) {
      throw new TodoError(403, `That was more than ${UNDO_MINUTES} minutes ago. Ask the office to correct it.`);
    }
  }
  await client.delete(id);
  if (move.photo) await dropPhoto(move.photo, "store");
  return getItem(move.itemId);
}
