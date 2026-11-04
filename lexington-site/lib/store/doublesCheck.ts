import "server-only";

import { randomBytes } from "node:crypto";

import { claudeConfigured, writeWithClaude, type ClaudeContent, type JsonSchema } from "@/lib/ai/claude";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { ITEM_PREFIX, TOOL_PREFIX } from "@/lib/site/ids";
import type { TodoMe } from "@/lib/todo/shared";
import { bestScore, cleanDoubleList, MAX_DOUBLE_WHY, MAX_DOUBLES, type StoreDouble } from "./doubles";

// Is it on the list already? (lib/store/doubles.ts says why.) Claude sees the new entry's photo and name, the closest
// entries by name with their photos, and the rest of the list by name, and names what it might be. Without Claude (no
// key, an error, too slow) the names decide alone. The same look runs afterwards, on the office's side, for anything on
// "To check" that never had one (added from a phone with the app from before, or before this existed).

type Kind = "item" | "tool";

/** What's being added: its kind, name and photo (an uploaded one, not "pending:"), and how it's counted. */
export interface NewEntry {
  kind: Kind;
  name: string;
  photoId: string | null;
  unit?: string | null;
  count?: number | null;
  category?: string | null;
}

interface ListEntry {
  kind: Kind;
  id: string;
  name: string;
  aliases: string[];
  unit: string | null;
  count: number | null;
  category: string | null;
  photo: string | null;
  createdAt: string | null;
}

const PHOTO_RE = /^image-([a-f0-9]{40})-(\d+x\d+)-(jpg|png|webp)$/;
/** Closest entries by name shown to Claude with their photos. */
const SHOWN = 8;
/** As close as this by name alone: asked about when Claude can't look (two of three words alike isn't enough). */
const NAME_ALONE = 0.7;
const CLAUDE_WAIT_MS = 25_000;

async function listEntries(): Promise<ListEntry[]> {
  const data = await getBuyersClient().fetch<{ items: Omit<ListEntry, "kind" | "count">[]; tools: Omit<ListEntry, "kind" | "aliases" | "unit" | "category">[] }>(
    `{
      "items": *[_type == "storeItem" && string::startsWith(_id, $itemPrefix)]{ "id": _id, "name": coalesce(name, ""), "aliases": coalesce(aliases, []), "unit": unit, "category": category, "photo": photo.asset._ref, createdAt },
      "tools": *[_type == "storeTool" && string::startsWith(_id, $toolPrefix) && coalesce(retired, false) == false]{ "id": _id, "name": coalesce(name, ""), "count": coalesce(count, 0), "photo": photo.asset._ref, createdAt }
    }`,
    { itemPrefix: ITEM_PREFIX, toolPrefix: TOOL_PREFIX }
  );
  return [
    ...data.items.map((i) => ({ ...i, kind: "item" as const, count: null })),
    ...data.tools.map((t) => ({ ...t, kind: "tool" as const, aliases: [], unit: null, category: null })),
  ];
}

/** A smaller copy of a stored photo, as Claude takes it; null when it can't be had just now. */
async function photoData(assetId: string, width: number): Promise<string | null> {
  const m = PHOTO_RE.exec(assetId);
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET;
  if (!m || !projectId || !dataset) return null;
  const url = `https://cdn.sanity.io/images/${projectId}/${dataset}/${m[1]}-${m[2]}.${m[3]}?w=${width}&h=${width}&fit=max&fm=jpg&q=70`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer()).toString("base64");
      // Just uploaded: give the image store a moment.
      if (response.status !== 404) return null;
    } catch {
      return null;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

const SYSTEM = `You keep the store room list of The Lexington, an apartment building under construction in Accra, Ghana, free of doubles. Site staff add the materials and tools in the store room to the list, with a name they type and usually a photo. Their names are often misspelt or worded their own way ("Sqaure", "Drill bit10", "Pu- Foam"), and sometimes they add something that is already on the list under another name. You see the new entry and the list. The person adding it is shown the entries you name and asked whether it's one of them, so name real candidates only.

Rules:
- The same thing: the same product, material or kind of tool, whatever the wording, spelling, word order or language ("Drill bit 12" and "12mm Drill bit"; "Wawa board" and "Wawa board 10 pcs"; "Pu- Foam" and "Polyurethane foam"). A count or a quantity in a name doesn't make it a different thing.
- Not the same: another size, grade or type of it (10 mm and 12 mm drill bits; 2" and 4" nails; cement 32.5 and 42.5; a small and a big wall hammer; a corded and a cordless drill).
- The list holds materials and tools: something added as a material can be on the list as a tool, and the other way round. Check both.
- Photos: you see the new entry's photo and the closest entries' photos. The same packaging, label, brand, colour or shape is a strong sign; a photo can also show that two similar names are different things. Store room photos are often dark or blurred: judge what you can see, and never name an entry for a blurred photo alone.
- same: "yes" when you're confident it's the same thing, "maybe" when it could well be (the same product from another brand, say).
- why: one short plain sentence the storekeeper understands, e.g. "Both are 12 mm masonry drill bits." or "The green PU-Foam can is in its photo too."
- At most ${MAX_DOUBLES} entries, the likeliest first. Most new entries are new: answer with no matches unless there's a real candidate.`;

const SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: { ref: { type: "string" }, same: { type: "string", enum: ["yes", "maybe"] }, why: { type: "string" } },
        required: ["ref", "same", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

const describe = (e: { kind: Kind; name: string; unit?: string | null; count?: number | null; category?: string | null }) =>
  e.kind === "item"
    ? `a material "${e.name}" (counted in ${e.unit || "pcs"}${e.category ? `, ${e.category}` : ""})`
    : `a tool "${e.name}"${typeof e.count === "number" ? ` (${e.count} of them)` : ""}`;

/** Claude's look: its matches as list entries, or null when it couldn't answer. */
async function askClaude(entry: NewEntry, all: ListEntry[], closest: ListEntry[]): Promise<StoreDouble[] | null> {
  const refs = new Map<string, ListEntry>();
  let items = 0;
  let tools = 0;
  for (const e of all) refs.set(e.kind === "item" ? `i${items++}` : `t${tools++}`, e);
  const refOf = new Map([...refs].map(([ref, e]) => [e.id, ref]));
  const line = (e: ListEntry) => `[${refOf.get(e.id)}] ${describe(e)}`;

  const [own, ...theirs] = await Promise.all([entry.photoId ? photoData(entry.photoId, 640) : Promise.resolve(null), ...closest.map((e) => (e.photo && entry.photoId ? photoData(e.photo, 400) : Promise.resolve(null)))]);
  const content: ClaudeContent = [{ type: "text", text: `The new entry being added: ${describe(entry)}.${own ? " Its photo:" : " It has no photo."}` }];
  if (own) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: own } });
  if (closest.length) {
    content.push({ type: "text", text: `The closest entries on the list by name${own ? ", with their photos where they have one" : ""}:` });
    closest.forEach((e, i) => {
      content.push({ type: "text", text: line(e) });
      const data = theirs[i];
      if (data) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
    });
  }
  const rest = all.filter((e) => !closest.includes(e));
  if (rest.length) content.push({ type: "text", text: `${closest.length ? "Everything else" : "Everything"} on the list:\n${rest.map(line).join("\n")}` });
  content.push({ type: "text", text: "Is the new entry already on the list? Answer with the entries' refs, as in [t3] without the brackets." });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const answer = await Promise.race([
    writeWithClaude<{ matches: { ref: string; same: string; why: string }[] }>({ system: SYSTEM, content, schema: SCHEMA, effort: "low", maxTokens: 3000, purpose: "store double check" }),
    new Promise<null>((r) => (timer = setTimeout(() => r(null), CLAUDE_WAIT_MS))),
  ]).finally(() => clearTimeout(timer));
  if (!answer) {
    console.error("[store doubles] Claude took too long: the names decide");
    return null;
  }
  if (!answer.ok) {
    console.error("[store doubles]", answer.error);
    return null;
  }
  const out: StoreDouble[] = [];
  for (const m of answer.value.matches ?? []) {
    const e = refs.get(String(m.ref).replace(/[[\]\s]/g, ""));
    if (!e || out.some((o) => o.id === e.id)) continue;
    out.push({ kind: e.kind, id: e.id, why: String(m.why ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_DOUBLE_WHY), sure: m.same === "yes" });
  }
  return out;
}

/**
 * What the new entry might be a double of, the likeliest first: the same photo for certain, then what Claude names (or,
 * without Claude, close names). `exclude` and `before`: the office's look at one already on the list (only what was
 * there before it counts).
 */
export async function findDoubles(entry: NewEntry, opts: { exclude?: string; before?: string | null } = {}): Promise<{ doubles: StoreDouble[]; by: "claude" | "names" }> {
  const all = (await listEntries()).filter((e) => e.id !== opts.exclude && (!opts.before || !e.createdAt || e.createdAt < opts.before));
  if (!all.length || !entry.name.trim()) return { doubles: [], by: "names" };
  const scored = all
    .map((e) => ({ e, score: bestScore(entry.name, [e.name, ...e.aliases]) }))
    .filter((s) => s.score >= 0.3)
    .sort((a, b) => b.score - a.score);
  const samePhoto: StoreDouble[] = entry.photoId
    ? all.filter((e) => e.photo === entry.photoId).map((e) => ({ kind: e.kind, id: e.id, why: "It has the very same photo.", sure: true }))
    : [];
  const closest = [...all.filter((e) => e.photo === entry.photoId && entry.photoId), ...scored.map((s) => s.e)]
    .filter((e, i, list) => list.indexOf(e) === i)
    .slice(0, SHOWN);

  const looked = claudeConfigured() ? await askClaude(entry, all, closest) : null;
  const named =
    looked ??
    scored
      .filter((s) => s.score >= NAME_ALONE)
      .map((s) => ({ kind: s.e.kind, id: s.e.id, why: s.e.name.toLowerCase() === entry.name.trim().toLowerCase() ? "The same name." : "It has a name like it.", sure: false }));
  const doubles = [...samePhoto, ...named].filter((d, i, list) => list.findIndex((o) => o.id === d.id) === i).slice(0, MAX_DOUBLES);
  return { doubles, by: looked ? "claude" : "names" };
}

/** Doubles as stored on a record's "To check" (each with its key, as lists of objects in the store have). */
export const keyed = (doubles: StoreDouble[]) => doubles.map((d) => ({ _key: randomBytes(6).toString("hex"), ...d }));

/**
 * A site login's new entry's "To check": who, when, and what the phone's check found (they were asked, and said it's
 * new). An app from before sends none: the office's look does it then.
 */
export async function newReview(me: TodoMe, sent: unknown): Promise<Record<string, unknown> | null> {
  if (me.kind === "admin") return null;
  const at = new Date().toISOString();
  const doubles = cleanDoubleList(sent);
  if (!doubles) return { by: me.name, byId: me.id, at };
  const there = await stillThere(doubles);
  return { by: me.name, byId: me.id, at, looked: at, ...(there.length ? { doubles: keyed(there), said: "new" } : {}) };
}

/** Of these, the ones still on the list. */
export async function stillThere(doubles: StoreDouble[]): Promise<StoreDouble[]> {
  if (!doubles.length) return [];
  const ids = new Set(await getBuyersClient().fetch<string[]>(`*[_id in $ids && _type in ["storeItem", "storeTool"]]._id`, { ids: doubles.map((d) => d.id) }));
  return doubles.filter((d) => ids.has(d.id) && d.id.startsWith(d.kind === "item" ? ITEM_PREFIX : TOOL_PREFIX));
}

/**
 * The office's look at what waits on "To check" without one (a few at a time, from the store page's own reads): each
 * gets its doubles (or none) and isn't looked at again. A record changed meanwhile (checked, changed) is left alone.
 */
export async function lookAtWaiting(): Promise<void> {
  const client = getBuyersClient();
  const now = Date.now();
  const waiting = await client.fetch<
    { _id: string; _type: string; _rev: string; name?: string; unit?: string; count?: number; category?: string; createdAt?: string; reviewAt?: string; photo?: string }[]
  >(
    `*[_type in ["storeItem", "storeTool"] && (string::startsWith(_id, $itemPrefix) || string::startsWith(_id, $toolPrefix)) && defined(review.at) && !defined(review.looked) && coalesce(review.lookingAt, "") < $stale]
      | order(review.at asc)[0...4]{ _id, _type, _rev, name, unit, count, category, createdAt, "reviewAt": review.at, "photo": photo.asset._ref }`,
    { itemPrefix: ITEM_PREFIX, toolPrefix: TOOL_PREFIX, stale: new Date(now - 3 * 60_000).toISOString() }
  );
  const one = async (w: (typeof waiting)[number]) => {
    try {
      // Taken for a few minutes, so the next read doesn't look at it too.
      const leased = await client.patch(w._id).ifRevisionId(w._rev).set({ "review.lookingAt": new Date().toISOString() }).commit();
      const kind: Kind = w._type === "storeItem" ? "item" : "tool";
      const { doubles } = await findDoubles(
        { kind, name: w.name ?? "", photoId: w.photo && PHOTO_RE.test(w.photo) ? w.photo : null, unit: w.unit, count: w.count, category: w.category },
        { exclude: w._id, before: w.createdAt ?? w.reviewAt }
      );
      await client
        .patch(w._id)
        .ifRevisionId(leased._rev)
        .set({ "review.looked": new Date().toISOString(), ...(doubles.length ? { "review.doubles": keyed(doubles) } : {}) })
        .unset(["review.lookingAt"])
        .commit();
    } catch (error) {
      // Changed meanwhile (the office checked it), or the store couldn't be reached: the next read tries again.
      if ((error as { statusCode?: number })?.statusCode !== 409) console.error("[store doubles] look failed:", error instanceof Error ? error.message : error);
    }
  };
  // Two at a time: gentle on Claude's limits when a long list waits (the page asks again every few seconds anyway).
  for (let i = 0; i < waiting.length; i += 2) await Promise.all(waiting.slice(i, i + 2).map(one));
}
