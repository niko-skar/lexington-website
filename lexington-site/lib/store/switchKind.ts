import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { isId, ITEM_PREFIX, MOVE_PREFIX, newId, TOOL_PREFIX } from "@/lib/site/ids";
import { cleanText, dropPhoto, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { guessCategory, guessItemTrade, guessToolTrade } from "./categories";
import { findItem, getItem } from "./server";
import { isCondition, isTrade, MAX_TOOL_COUNT, MAX_UNIT, type StoreItem, type StoreTool } from "./shared";
import { findTool, getTool, outNow } from "./tools";

// A material that's really a tool, or a tool that's really a material (Niko, 6 Nov 2026: "my ... new storekeeper keeps
// adding tools into materials and vice versa, can you put it in the change panel that I can turn it from a tool into a
// material or the otherway round?"). The office's Change sheet moves it across: the other kind with its name, photo,
// who uses it, who added it and how many there are, its lines on the shopping list and in orders, and what other new
// things might be a double of it. Its own record doesn't move over (a material's takes and counts aren't a tool's
// take-outs): that goes with the old one, and purchases of a material stay in the expenses, no longer counted into the
// store (as when it's deleted). The office looked at it: it's off To check.

const GONE = "That isn't on the list any more. Refresh the page.";

type Look = { _id: string; doubles: { _key: string; id: string }[] | null };
/** The new things that might be a double of it (their To check cards). */
const LOOKS = `*[_type in ["storeItem", "storeTool"] && $id in review.doubles[].id]{ _id, "doubles": review.doubles[]{ _key, id } }`;
type Tx = ReturnType<ReturnType<typeof getBuyersClient>["transaction"]>;

/** What might be a double of the old one might be a double of the new one. */
function pointLooks(tx: Tx, looks: readonly Look[], fromId: string, kind: "item" | "tool", toId: string) {
  for (const look of looks) {
    for (const d of look.doubles ?? []) {
      if (d.id === fromId) tx.patch(look._id, (p) => p.set({ [`review.doubles[_key=="${d._key}"].kind`]: kind, [`review.doubles[_key=="${d._key}"].id`]: toId }));
    }
  }
}

const numberOf = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN);

/** A material that's a tool: on the tool list with how many we have and the state it's in. */
export async function itemToTool(me: TodoMe, id: string, body: Record<string, unknown>): Promise<StoreTool> {
  if (!isId(ITEM_PREFIX, id)) throw new TodoError(404, GONE);
  const count = numberOf(body.count);
  if (!Number.isInteger(count) || count < 0 || count > MAX_TOOL_COUNT) throw new TodoError(400, "Type how many we have (0 if none).");
  if (!isCondition(body.condition)) throw new TodoError(400, "Pick the state it's in.");
  const client = getBuyersClient();
  type Item = { name: string; photo?: Record<string, unknown>; trade?: string; createdAt?: string; createdBy?: string };
  const found = await client.fetch<{ item: Item | null; moves: { _id: string; photo?: string }[]; bought: string[]; boughtMore: string[]; buys: string[]; orders: string[]; looks: Look[] }>(
    `{
      "item": *[_id == $id && _type == "storeItem"][0]{ name, photo, trade, createdAt, createdBy },
      "moves": *[_type == "storeMove" && itemId == $id]{ _id, "photo": photo.asset._ref },
      "bought": *[_type == "siteExpense" && itemId == $id]._id,
      "boughtMore": *[_type == "siteExpense" && $id in moreLines[].itemId]._id,
      "buys": *[_type == "storeBuy" && itemId == $id]._id,
      "orders": *[_type == "purchaseOrder" && $id in lines[].itemId]._id,
      "looks": ${LOOKS}
    }`,
    { id }
  );
  if (!found.item) throw new TodoError(404, GONE);
  const name = found.item.name;
  if (await findTool(name)) throw new TodoError(409, `"${name}" is on the tool list already. If it's the same thing, delete this one.`);

  const toolId = newId(TOOL_PREFIX);
  const tx = client.transaction();
  tx.create({
    _id: toolId,
    _type: "storeTool",
    name,
    count,
    trade: isTrade(found.item.trade) ? found.item.trade : guessToolTrade(name),
    condition: body.condition,
    ...(found.item.photo ? { photo: found.item.photo } : {}),
    createdAt: found.item.createdAt ?? new Date().toISOString(),
    createdBy: found.item.createdBy ?? me.name,
  });
  for (const move of found.moves) tx.delete(move._id);
  for (const expense of found.bought) tx.patch(expense, (p) => p.set({ toStore: false }).unset(["itemId"]));
  const line = `moreLines[itemId == "${id}"]`;
  for (const expense of found.boughtMore) tx.patch(expense, (p) => p.set({ [`${line}.toStore`]: false }).unset([`${line}.itemId`]));
  for (const buy of found.buys) tx.patch(buy, (p) => p.set({ toolId, category: "Tools" }).unset(["itemId"]));
  const orderLine = `lines[itemId == "${id}"]`;
  for (const order of found.orders) tx.patch(order, (p) => p.set({ [`${orderLine}.toolId`]: toolId }).unset([`${orderLine}.itemId`]));
  pointLooks(tx, found.looks, id, "tool", toolId);
  tx.delete(id);
  await tx.commit();
  for (const move of found.moves) if (move.photo) await dropPhoto(move.photo, "store");
  const tool = await getTool(toolId);
  if (!tool) throw new TodoError(502, "It moved to the tools but couldn't be read back. Refresh the page.");
  return tool;
}

/** A tool that's a material: in the store's stock, counted in a unit. Not while some are out or waiting to be fixed. */
export async function toolToItem(me: TodoMe, id: string, body: Record<string, unknown>): Promise<StoreItem> {
  if (!isId(TOOL_PREFIX, id)) throw new TodoError(404, GONE);
  const n = numberOf(body.count);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new TodoError(400, "Type how many there are now (0 if none).");
  const count = Math.round(n * 1000) / 1000;
  const unit = cleanText(body.unit, MAX_UNIT, "unit").replace(/\s+/g, " ").toLowerCase() || "pcs";
  const client = getBuyersClient();
  type Tool = { name: string; photo?: Record<string, unknown>; trade?: string; createdAt?: string; createdBy?: string };
  const found = await client.fetch<{
    tool: Tool | null;
    outs: { _id: string; photo?: string; returns: (string | null)[] | null }[];
    repairs: { _id: string; state?: string; photo?: string }[];
    buys: string[];
    orders: string[];
    looks: Look[];
  }>(
    `{
      "tool": *[_id == $id && _type == "storeTool"][0]{ name, photo, trade, createdAt, createdBy },
      "outs": *[_type == "toolOut" && toolId == $id]{ _id, "photo": photo.asset._ref, "returns": returns[].photo.asset._ref },
      "repairs": *[_type == "toolRepair" && toolId == $id]{ _id, state, "photo": photo.asset._ref },
      "buys": *[_type == "storeBuy" && toolId == $id]._id,
      "orders": *[_type == "purchaseOrder" && $id in lines[].toolId]._id,
      "looks": ${LOOKS}
    }`,
    { id }
  );
  if (!found.tool) throw new TodoError(404, GONE);
  const out = await outNow(id);
  if (out > 0) throw new TodoError(409, `${out} ${out === 1 ? "is" : "are"} out with someone now: take ${out === 1 ? "it" : "them"} back first.`);
  if (found.repairs.some((r) => r.state === "waiting" || r.state === "away")) {
    throw new TodoError(409, "It's on the Needs fixing list: mark that fixed or scrapped first.");
  }
  const name = found.tool.name;
  if (await findItem(name)) throw new TodoError(409, `"${name}" is in the store already. If it's the same thing, delete this one.`);

  const category = guessCategory(name);
  const itemId = newId(ITEM_PREFIX);
  const at = new Date().toISOString();
  const tx = client.transaction();
  tx.create({
    _id: itemId,
    _type: "storeItem",
    name,
    unit,
    category,
    trade: isTrade(found.tool.trade) ? found.tool.trade : guessItemTrade(name, category),
    stocked: true,
    ...(found.tool.photo ? { photo: found.tool.photo } : {}),
    createdAt: found.tool.createdAt ?? at,
    createdBy: found.tool.createdBy ?? me.name,
  });
  // What's on the shelf now: its starting count, as a new item's.
  tx.create({ _id: newId(MOVE_PREFIX), _type: "storeMove", itemId, kind: "count", qty: count, diff: count, opening: true, note: "", at, by: me.name, byId: me.id });
  for (const o of found.outs) tx.delete(o._id);
  for (const r of found.repairs) tx.delete(r._id);
  for (const buy of found.buys) tx.patch(buy, (p) => p.set({ itemId, category }).unset(["toolId"]));
  const orderLine = `lines[toolId == "${id}"]`;
  for (const order of found.orders) tx.patch(order, (p) => p.set({ [`${orderLine}.itemId`]: itemId }).unset([`${orderLine}.toolId`]));
  pointLooks(tx, found.looks, id, "item", itemId);
  tx.delete(id);
  await tx.commit();
  // Tools taken out together share a photo: dropPhoto keeps one something still uses.
  const photos = new Set([...found.outs.flatMap((o) => [o.photo, ...(o.returns ?? [])]), ...found.repairs.map((r) => r.photo)].filter((p): p is string => !!p));
  for (const photo of photos) await dropPhoto(photo, "store");
  const item = await getItem(itemId);
  if (!item) throw new TodoError(502, "It moved to the materials but couldn't be read back. Refresh the page.");
  return item;
}
