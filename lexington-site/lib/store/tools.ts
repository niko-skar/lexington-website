import "server-only";

import { randomBytes } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { isId, newId, TOOL_OUT_PREFIX, TOOL_PREFIX } from "@/lib/site/ids";
import { cleanPhotoRef, cleanText, dropPhoto, photoRef, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import {
  MAX_MOVE_NOTE,
  MAX_PERSON,
  MAX_TOOL_COUNT,
  MAX_TOOL_NAME,
  UNDO_MINUTES,
  type StoreTool,
  type ToolOut,
  type ToolReturn,
} from "./shared";

// Tools (Niko, 23 Oct 2026: "a section for tools with daily take outs and returns"). Each take-out
// is one record per tool, with who took it; what comes back is written onto that same record, so
// "still out" can never disagree with the returns. Tools taken together share one photo. A tool's
// number is how many we have: the office keeps it right, and marking one lost takes it off.

export const TOOL_FIELDS = `{
  "id": _id,
  "name": coalesce(name, ""),
  "count": coalesce(count, 0),
  "retired": coalesce(retired, false),
  "photoUrl": photo.asset->url
}`;
export const OUT_FIELDS = `{
  "id": _id, toolId, qty, "person": coalesce(person, ""), "note": coalesce(note, ""), "photoUrl": photo.asset->url,
  at, "by": coalesce(by, ""), byId, "closedAt": closedAt,
  "returns": coalesce(returns[]{
    "key": _key, qty, "lost": coalesce(lost, false), "note": coalesce(note, ""), "photoUrl": photo.asset->url, at, "by": coalesce(by, ""), byId
  }, [])
}`;

type RawReturn = Omit<ToolReturn, "mine"> & { byId?: string };
export type RawOut = Omit<ToolOut, "mine" | "returns"> & { byId?: string; returns: RawReturn[] };

/** Marks what whoever is looking recorded themselves (they can undo it for a few minutes). */
export function toOut(me: TodoMe, { byId, returns, ...out }: RawOut): ToolOut {
  return {
    ...out,
    mine: !!byId && byId === me.id,
    returns: returns.map(({ byId: returnBy, ...r }) => ({ ...r, mine: !!returnBy && returnBy === me.id })),
  };
}

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const GONE = "That tool isn't on the list any more.";
const OUT_GONE = "That take-out isn't on the record any more. Refresh the page.";

function cleanToolName(value: unknown) {
  const name = cleanText(value, MAX_TOOL_NAME, "name").replace(/\s+/g, " ");
  if (!name) throw new TodoError(400, "Type what the tool is, e.g. Angle grinder.");
  return name;
}
function cleanWhole(value: unknown, min: number, message: string) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > MAX_TOOL_COUNT) throw new TodoError(400, message);
  return n;
}
/** Two people saving the same take-out at the same moment: the second looks again. */
const isClash = (error: unknown) => (error as { statusCode?: number })?.statusCode === 409;

async function findTool(name: string): Promise<string | null> {
  return getBuyersClient().fetch(`*[_type == "storeTool" && string::startsWith(_id, $prefix) && lower(name) == $key][0]._id`, {
    prefix: TOOL_PREFIX,
    key: key(name),
  });
}

export async function getTool(id: string): Promise<StoreTool | null> {
  return getBuyersClient().fetch<StoreTool | null>(`*[_id == $id && _type == "storeTool"][0] ${TOOL_FIELDS}`, { id });
}

/** How many of a tool are out now (taken, not back yet). */
async function outNow(id: string): Promise<number> {
  return getBuyersClient().fetch<number>(
    `coalesce(math::sum(*[_type == "toolOut" && toolId == $id && !defined(closedAt)].qty), 0) - coalesce(math::sum(*[_type == "toolOut" && toolId == $id && !defined(closedAt)].returns[].qty), 0)`,
    { id }
  );
}

async function readOuts(me: TodoMe, ids: string[]): Promise<ToolOut[]> {
  const raw = await getBuyersClient().fetch<RawOut[]>(`*[_type == "toolOut" && _id in $ids] | order(at desc) ${OUT_FIELDS}`, { ids });
  return raw.map((o) => toOut(me, o));
}

/* ---------- the list of tools ---------- */

/** A tool for the list, with how many we have and a photo. Anyone who uses the store. */
export async function createTool(me: TodoMe, body: Record<string, unknown>): Promise<StoreTool> {
  const name = cleanToolName(body.name);
  const count = cleanWhole(body.count, 0, "Type how many we have (0 if none).");
  const photoId = cleanPhotoRef(body.photoId);
  if (await findTool(name)) throw new TodoError(409, `"${name}" is already on the tool list.`);
  const id = newId(TOOL_PREFIX);
  await getBuyersClient().create({
    _id: id,
    _type: "storeTool",
    name,
    count,
    ...(photoId ? { photo: photoRef(photoId) } : {}),
    createdAt: new Date().toISOString(),
    createdBy: me.name,
  });
  const tool = await getTool(id);
  if (!tool) throw new TodoError(502, "It was saved but couldn't be read back. Refresh the page.");
  return tool;
}

/** A new photo of a tool. Anyone who uses the store. */
export async function setToolPhoto(id: string, value: unknown): Promise<StoreTool> {
  if (!isId(TOOL_PREFIX, id)) throw new TodoError(404, GONE);
  const photoId = cleanPhotoRef(value);
  if (!photoId) throw new TodoError(400, "Take a photo first.");
  const client = getBuyersClient();
  const before = await client.fetch<{ photo?: string } | null>(`*[_id == $id && _type == "storeTool"][0]{ "photo": photo.asset._ref }`, { id });
  if (!before) throw new TodoError(404, GONE);
  await client.patch(id).set({ photo: photoRef(photoId) }).commit();
  if (before.photo && before.photo !== photoId) await dropPhoto(before.photo, "store");
  const tool = await getTool(id);
  if (!tool) throw new TodoError(404, GONE);
  return tool;
}

/** The office: rename, how many we have, or "not used any more". */
export async function updateTool(id: string, body: Record<string, unknown>): Promise<StoreTool> {
  if (!isId(TOOL_PREFIX, id)) throw new TodoError(404, GONE);
  const before = await getTool(id);
  if (!before) throw new TodoError(404, GONE);
  const set: Record<string, unknown> = {};
  if ("name" in body) {
    const name = cleanToolName(body.name);
    if (key(name) !== key(before.name)) {
      const clash = await findTool(name);
      if (clash && clash !== id) throw new TodoError(409, `There's already "${name}" on the tool list.`);
      set.name = name;
    }
  }
  if ("count" in body) {
    const count = cleanWhole(body.count, 0, "Type how many we have (0 if none).");
    const out = await outNow(id);
    if (count < out) {
      throw new TodoError(409, `${out} ${out === 1 ? "is" : "are"} out now, so we have at least ${out}. Record what came back (or mark it lost) first.`);
    }
    set.count = count;
  }
  if ("retired" in body) set.retired = body.retired === true;
  if (Object.keys(set).length) await getBuyersClient().patch(id).set(set).commit();
  const tool = await getTool(id);
  if (!tool) throw new TodoError(404, GONE);
  return tool;
}

/** Everything that ever went out for one tool, newest first. */
export async function toolHistory(me: TodoMe, id: string): Promise<{ tool: StoreTool; outs: ToolOut[] }> {
  if (!isId(TOOL_PREFIX, id)) throw new TodoError(404, GONE);
  const data = await getBuyersClient().fetch<{ tool: StoreTool | null; outs: RawOut[] }>(
    `{
      "tool": *[_id == $id && _type == "storeTool"][0] ${TOOL_FIELDS},
      "outs": *[_type == "toolOut" && toolId == $id] | order(at desc)[0...500] ${OUT_FIELDS}
    }`,
    { id }
  );
  if (!data.tool) throw new TodoError(404, GONE);
  return { tool: data.tool, outs: data.outs.map((o) => toOut(me, o)) };
}

/* ---------- out and back ---------- */

/** Tools going out with one person: one record per tool, all with the same photo. */
export async function takeOutTools(me: TodoMe, body: Record<string, unknown>): Promise<ToolOut[]> {
  const person = cleanText(body.person, MAX_PERSON, "name");
  if (!person) throw new TodoError(400, "Type who is taking them.");
  const note = cleanText(body.note, MAX_MOVE_NOTE, "note");
  const photoId = cleanPhotoRef(body.photoId);
  // Niko, 23 Oct 2026: anything going out of the store goes with a photo of it.
  if (!photoId) throw new TodoError(400, "Take a photo of the tools going out first.");
  const wanted = new Map<string, number>();
  for (const line of Array.isArray(body.lines) ? body.lines : []) {
    const { toolId, qty } = (line ?? {}) as { toolId?: unknown; qty?: unknown };
    if (!isId(TOOL_PREFIX, toolId)) throw new TodoError(404, GONE);
    wanted.set(toolId, (wanted.get(toolId) ?? 0) + cleanWhole(qty, 1, "Say how many of each tool."));
  }
  if (wanted.size === 0) throw new TodoError(400, "Pick the tools going out.");
  if (wanted.size > 40) throw new TodoError(400, "That's a lot at once: save it in two goes.");
  const client = getBuyersClient();
  const ids = [...wanted.keys()];
  const found = await client.fetch<string[]>(`*[_type == "storeTool" && _id in $ids]._id`, { ids });
  if (found.length !== ids.length) throw new TodoError(404, GONE);

  const at = new Date().toISOString();
  const tx = client.transaction();
  const made: string[] = [];
  for (const [toolId, qty] of wanted) {
    const _id = newId(TOOL_OUT_PREFIX);
    made.push(_id);
    tx.create({ _id, _type: "toolOut", toolId, qty, person, note, photo: photoRef(photoId), returns: [], at, by: me.name, byId: me.id });
  }
  await tx.commit();
  return readOuts(me, made);
}

/**
 * Closes (some of) one or more take-outs: what came back, or (the office) what never will. "rest"
 * means all that is still out. A tool marked lost comes off how many we have.
 */
async function closeOuts(
  me: TodoMe,
  wanted: Map<string, number | "rest">,
  extra: { note: string; photoId: string | null; lost: boolean }
): Promise<ToolOut[]> {
  const client = getBuyersClient();
  const ids = [...wanted.keys()];
  for (let attempt = 0; ; attempt++) {
    const docs = await client.fetch<{ _id: string; _rev: string; toolId: string; qty: number; returns: { qty: number }[] | null }[]>(
      `*[_type == "toolOut" && _id in $ids]{ _id, _rev, toolId, qty, "returns": returns[]{ qty } }`,
      { ids }
    );
    if (docs.length !== ids.length) throw new TodoError(404, OUT_GONE);
    const at = new Date().toISOString();
    const tx = client.transaction();
    const lost = new Map<string, number>();
    for (const doc of docs) {
      const left = doc.qty - (doc.returns ?? []).reduce((n, r) => n + (r.qty || 0), 0);
      if (left <= 0) throw new TodoError(409, "That's already all back. Refresh the page.");
      const asked = wanted.get(doc._id)!;
      const qty = asked === "rest" ? left : asked;
      if (qty > left) throw new TodoError(409, `Only ${left} of that ${left === 1 ? "is" : "are"} still out.`);
      const entry = {
        _key: randomBytes(6).toString("hex"),
        qty,
        ...(extra.lost ? { lost: true } : {}),
        note: extra.note,
        ...(extra.photoId ? { photo: photoRef(extra.photoId) } : {}),
        at,
        by: me.name,
        byId: me.id,
      };
      tx.patch(doc._id, (p) => {
        const patch = p.ifRevisionId(doc._rev).setIfMissing({ returns: [] }).append("returns", [entry]);
        return qty === left ? patch.set({ closedAt: at }) : patch;
      });
      if (extra.lost) lost.set(doc.toolId, (lost.get(doc.toolId) ?? 0) + qty);
    }
    for (const [toolId, qty] of lost) tx.patch(toolId, (p) => p.setIfMissing({ count: 0 }).dec({ count: qty }));
    try {
      await tx.commit();
      break;
    } catch (error) {
      if (attempt < 3 && isClash(error)) continue;
      throw error;
    }
  }
  return readOuts(me, ids);
}

/** What came back, from one or more take-outs, with an optional photo and note. Anyone using the store. */
export async function returnTools(me: TodoMe, body: Record<string, unknown>): Promise<ToolOut[]> {
  const note = cleanText(body.note, MAX_MOVE_NOTE, "note");
  const photoId = cleanPhotoRef(body.photoId);
  const wanted = new Map<string, number | "rest">();
  for (const line of Array.isArray(body.returns) ? body.returns : []) {
    const { outId, qty } = (line ?? {}) as { outId?: unknown; qty?: unknown };
    if (!isId(TOOL_OUT_PREFIX, outId)) throw new TodoError(404, OUT_GONE);
    wanted.set(outId, cleanWhole(qty, 1, "Say how many came back."));
  }
  if (wanted.size === 0) throw new TodoError(400, "Tick what came back.");
  if (wanted.size > 40) throw new TodoError(400, "That's a lot at once: save it in two goes.");
  return closeOuts(me, wanted, { note, photoId, lost: false });
}

/** The office: what's still out of a take-out is never coming back. */
export async function markLost(me: TodoMe, outId: unknown, note: unknown): Promise<ToolOut[]> {
  if (!isId(TOOL_OUT_PREFIX, outId)) throw new TodoError(404, OUT_GONE);
  return closeOuts(me, new Map([[outId, "rest"]]), { note: cleanText(note, MAX_MOVE_NOTE, "note"), photoId: null, lost: true });
}

function mayUndo(me: TodoMe, byId: string | undefined, at: string) {
  if (me.kind === "admin") return;
  if (byId !== me.id) throw new TodoError(403, "Only the office can remove what someone else recorded.");
  if (Date.now() - Date.parse(at) > UNDO_MINUTES * 60_000) {
    throw new TodoError(403, `That was more than ${UNDO_MINUTES} minutes ago. Ask the office to correct it.`);
  }
}

/** Undo a take-out recorded by mistake (only while none of it has come back). */
export async function deleteToolOut(me: TodoMe, id: string): Promise<void> {
  if (!isId(TOOL_OUT_PREFIX, id)) throw new TodoError(404, OUT_GONE);
  const client = getBuyersClient();
  const doc = await client.fetch<{ byId?: string; at: string; photo?: string; returns: number } | null>(
    `*[_id == $id && _type == "toolOut"][0]{ byId, at, "photo": photo.asset._ref, "returns": count(returns) }`,
    { id }
  );
  if (!doc) return;
  mayUndo(me, doc.byId, doc.at);
  if (doc.returns > 0) throw new TodoError(409, "Some of it has come back already: undo that first.");
  await client.delete(id);
  // Tools taken together share the photo: it only goes once nothing uses it.
  if (doc.photo) await dropPhoto(doc.photo, "store");
}

/** Undo a return (or, the office, a "lost") recorded by mistake: it's out again. */
export async function deleteToolReturn(me: TodoMe, outId: string, returnKey: string): Promise<ToolOut | null> {
  if (!isId(TOOL_OUT_PREFIX, outId) || !/^[a-f0-9]{12}$/.test(returnKey)) throw new TodoError(404, OUT_GONE);
  const client = getBuyersClient();
  let photo: string | undefined;
  for (let attempt = 0; ; attempt++) {
    const doc = await client.fetch<{
      _rev: string;
      toolId: string;
      returns: { _key: string; qty: number; lost?: boolean; byId?: string; at: string; photo?: string }[] | null;
    } | null>(`*[_id == $id && _type == "toolOut"][0]{ _rev, toolId, "returns": returns[]{ _key, qty, lost, byId, at, "photo": photo.asset._ref } }`, {
      id: outId,
    });
    if (!doc) return null;
    const entry = doc.returns?.find((r) => r._key === returnKey);
    if (!entry) break;
    if (entry.lost && me.kind !== "admin") throw new TodoError(403, "Only the office can change that.");
    mayUndo(me, entry.byId, entry.at);
    const tx = client.transaction().patch(outId, (p) => p.ifRevisionId(doc._rev).unset([`returns[_key=="${returnKey}"]`, "closedAt"]));
    if (entry.lost) tx.patch(doc.toolId, (p) => p.setIfMissing({ count: 0 }).inc({ count: entry.qty }));
    try {
      await tx.commit();
      photo = entry.photo;
      break;
    } catch (error) {
      if (attempt < 3 && isClash(error)) continue;
      throw error;
    }
  }
  if (photo) await dropPhoto(photo, "store");
  return (await readOuts(me, [outId]))[0] ?? null;
}
