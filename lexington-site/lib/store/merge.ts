import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { isId, ITEM_PREFIX, TOOL_PREFIX } from "@/lib/site/ids";
import { cleanPhotoRef, cleanText, dropPhoto, photoRef, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { addMove, getItem, key } from "./server";
import { MAX_ITEM_NAME, MAX_TOOL_COUNT, type StoreEntry, type StoreItem, type StoreTool } from "./shared";
import { findTool, getTool, outNow, updateTool } from "./tools";

// What becomes of a double (lib/store/doubles.ts).
// "Yes, it's this one": whoever was adding it says it's one already on the list. Nothing new goes on; what they counted
// goes on the one there (a material's count is anyone's to give; a tool's different number goes to the office, which
// keeps tool numbers), and their photo too if it has none.
// "Put together": the office says two are the same. Everything recorded on one moves onto the other, which keeps its
// name (or takes the other's), the old name still finding it; then the office says how many there are in all.

type Kind = "item" | "tool";
const isKind = (value: unknown): value is Kind => value === "item" || value === "tool";
const GONE = "That isn't on the list any more. Refresh the page.";

function cleanRef(value: unknown): { kind: Kind; id: string } {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (!isKind(v.kind) || !isId(v.kind === "item" ? ITEM_PREFIX : TOOL_PREFIX, v.id)) throw new TodoError(404, GONE);
  return { kind: v.kind, id: v.id };
}
const numberOf = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN);

export type SameResult = {
  item?: StoreItem;
  tool?: StoreTool;
  /** A material's count put on it. */
  entry?: StoreEntry;
  /** recorded: the count is on it; office: a tool's other number waits for the office; set: the office's own, set; same: it said that already. */
  counted: "recorded" | "office" | "set" | "same" | "none";
  /** The new photo went onto it (it had none): it stays. */
  photoUsed: boolean;
};

/** "Yes, it's this one": `into` is the one on the list; `kind`, `name`, `count`, `unit`, `photoId` what was being added. */
export async function sameThing(me: TodoMe, body: Record<string, unknown>): Promise<SameResult> {
  const into = cleanRef(body.into);
  const adding: Kind = isKind(body.kind) ? body.kind : into.kind;
  const name = cleanText(body.name, MAX_ITEM_NAME, "name") || "it";
  const photoId = cleanPhotoRef(body.photoId);
  const n = numberOf(body.count);
  const client = getBuyersClient();

  if (into.kind === "item") {
    const item = await getItem(into.id);
    if (!item) throw new TodoError(404, GONE);
    const photoUsed = !!photoId && !item.photoUrl;
    if (photoUsed) await client.patch(into.id).set({ photo: photoRef(photoId) }).commit();
    // What's on the shelf now, in the same unit: a count, like counting it there.
    if (adding === "item" && Number.isFinite(n) && n >= 0 && n <= 1_000_000 && typeof body.unit === "string" && key(body.unit) === key(item.unit)) {
      const { item: after, entry } = await addMove(me, {
        kind: "count",
        itemId: into.id,
        qty: n,
        note: `Counted when it was being added again as “${name}”`,
        ...(photoId && !photoUsed ? { photoId } : {}),
      });
      return { item: after, entry, counted: "recorded", photoUsed: !!photoId };
    }
    return { item: (await getItem(into.id)) ?? item, counted: "none", photoUsed };
  }

  const tool = await getTool(into.id);
  if (!tool) throw new TodoError(404, GONE);
  const photoUsed = !!photoId && !tool.photoUrl;
  if (photoUsed) await client.patch(into.id).set({ photo: photoRef(photoId) }).commit();
  let counted: SameResult["counted"] = "none";
  if (adding === "tool" && Number.isInteger(n) && n >= 0 && n <= MAX_TOOL_COUNT) {
    if (n === tool.count) counted = "same";
    else if (me.kind === "admin") {
      await updateTool(me, into.id, { count: n });
      counted = "set";
    } else {
      // The office keeps tool numbers: it's on "To check" with what they counted.
      const at = new Date().toISOString();
      await client
        .patch(into.id)
        .setIfMissing({ review: { by: me.name, byId: me.id, at, what: "counted", looked: at } })
        .set({ "review.counted": { by: me.name, at, count: n, was: tool.count } })
        .commit();
      counted = "office";
    }
  }
  return { tool: (await getTool(into.id)) ?? tool, counted, photoUsed };
}

/** The office: `from` goes into `into` (both materials, or both tools); name "from" keeps from's name; count: how many in all. */
export async function putTogether(me: TodoMe, body: Record<string, unknown>): Promise<{ item?: StoreItem; tool?: StoreTool }> {
  const from = cleanRef(body.from);
  const into = cleanRef(body.into);
  if (from.kind !== into.kind) throw new TodoError(400, "A material and a tool can't be put together. Delete the one that's wrong.");
  if (from.id === into.id) throw new TodoError(400, "That's the same one.");
  const keepFrom = body.name === "from";
  return from.kind === "item" ? putItems(me, from.id, into.id, keepFrom, body.count) : putTools(me, from.id, into.id, keepFrom, body.count);
}

async function putItems(me: TodoMe, fromId: string, intoId: string, keepFrom: boolean, countValue: unknown): Promise<{ item: StoreItem }> {
  const client = getBuyersClient();
  type Doc = { name: string; aliases?: string[]; unit?: string; photo?: string };
  const found = await client.fetch<{ from: Doc | null; into: Doc | null; moves: string[]; bought: string[]; boughtMore: string[]; buys: string[] }>(
    `{
      "from": *[_id == $from && _type == "storeItem"][0]{ name, aliases, unit, "photo": photo.asset._ref },
      "into": *[_id == $into && _type == "storeItem"][0]{ name, aliases, unit, "photo": photo.asset._ref },
      "moves": *[_type == "storeMove" && itemId == $from]._id,
      "bought": *[_type == "siteExpense" && itemId == $from]._id,
      "boughtMore": *[_type == "siteExpense" && $from in moreLines[].itemId]._id,
      "buys": *[_type == "storeBuy" && itemId == $from]._id
    }`,
    { from: fromId, into: intoId }
  );
  if (!found.from || !found.into) throw new TodoError(404, "One of them isn't on the list any more. Refresh the page.");
  const n = numberOf(countValue);
  const count = countValue === null || countValue === undefined || countValue === "" ? null : Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 1000) / 1000 : NaN;
  if (Number.isNaN(count)) throw new TodoError(400, "Type how many there are in all (0 if none).");
  if (count === null && key(found.from.unit ?? "pcs") !== key(found.into.unit ?? "pcs")) {
    throw new TodoError(400, `They're counted in different units: type how many there are in all, in ${found.into.unit ?? "pcs"}.`);
  }
  const name = keepFrom ? found.from.name : found.into.name;
  const aliases = new Set([...(found.into.aliases ?? []), ...(found.from.aliases ?? []), key(found.from.name), key(found.into.name)]);
  aliases.delete(key(name));

  // Its takes, counts and purchases are this one's now (purchases stay in the expenses as they are).
  const tx = client.transaction();
  for (const id of found.moves) tx.patch(id, (p) => p.set({ itemId: intoId }));
  for (const id of found.bought) tx.patch(id, (p) => p.set({ itemId: intoId }));
  const line = `moreLines[itemId == "${fromId}"]`;
  for (const id of found.boughtMore) tx.patch(id, (p) => p.set({ [`${line}.itemId`]: intoId }));
  // On the shopping list as more of it: more of the one kept.
  for (const id of found.buys) tx.patch(id, (p) => p.set({ itemId: intoId }));
  tx.patch(intoId, (p) =>
    p.set({ name, aliases: [...aliases], ...(!found.into!.photo && found.from!.photo ? { photo: photoRef(found.from!.photo) } : {}) }).unset(["review"])
  );
  tx.delete(fromId);
  await tx.commit();
  if (found.from.photo && found.into.photo) await dropPhoto(found.from.photo, "store");

  let item = await getItem(intoId);
  if (!item) throw new TodoError(502, "They were put together but couldn't be read back. Refresh the page.");
  // How many there are in all, as the office says: a count, so the record shows any gap.
  if (count !== null && count !== item.level) {
    item = (await addMove(me, { kind: "count", itemId: intoId, qty: count, note: `Counted when “${found.from.name}” was put together with it` })).item;
  }
  return { item };
}

async function putTools(me: TodoMe, fromId: string, intoId: string, keepFrom: boolean, countValue: unknown): Promise<{ tool: StoreTool }> {
  const client = getBuyersClient();
  type Doc = { name: string; count?: number; condition?: string; photo?: string };
  const found = await client.fetch<{ from: Doc | null; into: Doc | null; outs: string[]; repairs: string[]; buys: string[] }>(
    `{
      "from": *[_id == $from && _type == "storeTool"][0]{ name, count, condition, "photo": photo.asset._ref },
      "into": *[_id == $into && _type == "storeTool"][0]{ name, count, condition, "photo": photo.asset._ref },
      "outs": *[_type == "toolOut" && toolId == $from]._id,
      "repairs": *[_type == "toolRepair" && toolId == $from]._id,
      "buys": *[_type == "storeBuy" && toolId == $from]._id
    }`,
    { from: fromId, into: intoId }
  );
  if (!found.from || !found.into) throw new TodoError(404, "One of them isn't on the list any more. Refresh the page.");
  const count = numberOf(countValue);
  if (!Number.isInteger(count) || count < 0 || count > MAX_TOOL_COUNT) throw new TodoError(400, "Type how many we have in all (0 if none).");
  const out = (await outNow(fromId)) + (await outNow(intoId));
  if (count < out) throw new TodoError(409, `${out} ${out === 1 ? "is" : "are"} out now, so we have at least ${out}.`);
  const name = keepFrom ? found.from.name : found.into.name;
  const clash = keepFrom ? await findTool(name) : null;
  if (clash && clash !== fromId && clash !== intoId) throw new TodoError(409, `There's already "${name}" on the tool list.`);

  // Its take-outs and repairs are this one's now.
  const tx = client.transaction();
  for (const id of found.outs) tx.patch(id, (p) => p.set({ toolId: intoId }));
  for (const id of found.repairs) tx.patch(id, (p) => p.set({ toolId: intoId }));
  for (const id of found.buys) tx.patch(id, (p) => p.set({ toolId: intoId }));
  tx.patch(intoId, (p) =>
    p
      .set({
        name,
        count,
        ...(!found.into!.condition && found.from!.condition ? { condition: found.from!.condition } : {}),
        ...(!found.into!.photo && found.from!.photo ? { photo: photoRef(found.from!.photo) } : {}),
      })
      .unset(["review"])
  );
  tx.delete(fromId);
  await tx.commit();
  if (found.from.photo && found.into.photo) await dropPhoto(found.from.photo, "store");
  const tool = await getTool(intoId);
  if (!tool) throw new TodoError(502, "They were put together but couldn't be read back. Refresh the page.");
  return { tool };
}
