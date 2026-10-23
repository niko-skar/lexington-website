import "server-only";

import { randomBytes } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { CHECK_PREFIX, isId, newId, TOOL_OUT_PREFIX } from "@/lib/site/ids";
import { cleanPhotoRef, cleanText, dropPhoto, photoRef, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { MAX_CHECK_PHOTOS, MAX_MOVE_NOTE, UNDO_MINUTES, type StoreCheck } from "./shared";

// Opening and closing the store room (Niko, 23 Oct 2026: "daily pictures of opening store room and
// closing store room"). Whoever opens or closes it takes photos there and then; closing also notes
// how many tools were still out, as it was at that moment.

export const CHECK_FIELDS = `{
  "id": _id, kind, "photoUrls": coalesce(photos[].asset->url, []), "note": coalesce(note, ""), "toolsOut": toolsOut, at, "by": coalesce(by, ""), byId
}`;

export type RawCheck = Omit<StoreCheck, "mine"> & { byId?: string };
export const toCheck = (me: TodoMe, { byId, ...check }: RawCheck): StoreCheck => ({ ...check, mine: !!byId && byId === me.id });

/** Opened or closed, with its photos. Anyone who uses the store. */
export async function addCheck(me: TodoMe, body: Record<string, unknown>): Promise<StoreCheck> {
  const kind = body.kind;
  if (kind !== "open" && kind !== "close") throw new TodoError(400, "Unknown change.");
  const photoIds = [...new Set((Array.isArray(body.photoIds) ? body.photoIds : []).map(cleanPhotoRef).filter((p): p is string => !!p))];
  if (photoIds.length === 0) throw new TodoError(400, `Take a photo of the store room as you ${kind} it first.`);
  if (photoIds.length > MAX_CHECK_PHOTOS) throw new TodoError(400, `${MAX_CHECK_PHOTOS} photos at most.`);
  const note = cleanText(body.note, MAX_MOVE_NOTE, "note");
  const client = getBuyersClient();
  const toolsOut =
    kind === "close"
      ? await client.fetch<number>(
          `coalesce(math::sum(*[_type == "toolOut" && string::startsWith(_id, $prefix) && !defined(closedAt)].qty), 0) - coalesce(math::sum(*[_type == "toolOut" && string::startsWith(_id, $prefix) && !defined(closedAt)].returns[].qty), 0)`,
          { prefix: TOOL_OUT_PREFIX }
        )
      : null;
  const id = newId(CHECK_PREFIX);
  await client.create({
    _id: id,
    _type: "storeCheck",
    kind,
    photos: photoIds.map((p) => ({ _key: randomBytes(6).toString("hex"), ...photoRef(p) })),
    note,
    ...(toolsOut !== null ? { toolsOut } : {}),
    at: new Date().toISOString(),
    by: me.name,
    byId: me.id,
  });
  const saved = await client.fetch<RawCheck | null>(`*[_id == $id][0] ${CHECK_FIELDS}`, { id });
  if (!saved) throw new TodoError(502, "It was saved but couldn't be read back. Refresh the page.");
  return toCheck(me, saved);
}

/** Days before the ones the page already has (for "show older days"). */
export async function olderChecks(me: TodoMe, before: string | null): Promise<StoreCheck[]> {
  if (!before || Number.isNaN(Date.parse(before))) throw new TodoError(400, "Older than when?");
  const raw = await getBuyersClient().fetch<RawCheck[]>(
    `*[_type == "storeCheck" && string::startsWith(_id, $prefix) && at < $before] | order(at desc)[0...120] ${CHECK_FIELDS}`,
    { prefix: CHECK_PREFIX, before: new Date(before).toISOString() }
  );
  return raw.map((c) => toCheck(me, c));
}

/** Undo a wrong one: the office any time; whoever took it, for a few minutes. Its photos go too. */
export async function deleteCheck(me: TodoMe, id: string): Promise<void> {
  if (!isId(CHECK_PREFIX, id)) throw new TodoError(404, "That isn't on the record any more.");
  const client = getBuyersClient();
  const doc = await client.fetch<{ byId?: string; at: string; photos: string[] } | null>(
    `*[_id == $id && _type == "storeCheck"][0]{ byId, at, "photos": coalesce(photos[].asset._ref, []) }`,
    { id }
  );
  if (!doc) return;
  if (me.kind !== "admin") {
    if (doc.byId !== me.id) throw new TodoError(403, "Only the office can remove what someone else recorded.");
    if (Date.now() - Date.parse(doc.at) > UNDO_MINUTES * 60_000) {
      throw new TodoError(403, `That was more than ${UNDO_MINUTES} minutes ago. Ask the office to correct it.`);
    }
  }
  await client.delete(id);
  for (const photo of doc.photos) await dropPhoto(photo, "store");
}
