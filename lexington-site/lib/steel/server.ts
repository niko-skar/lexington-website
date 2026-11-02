import "server-only";
import { randomBytes } from "node:crypto";

import { listExpenses, setSteel, steelRate } from "@/lib/expenses/server";
import { FLOORS } from "@/lib/expenses/shared";
import { STEEL_PARTS, steelSummary, steelTracker, type SteelData, type SteelInstall } from "@/lib/expenses/steel";
import { areasWith } from "@/lib/quickbooks/books";
import { cachedBookLists } from "@/lib/quickbooks/booksCache";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { STEEL_INSTALL_PREFIX } from "@/lib/site/ids";
import { getStore } from "@/lib/store/server";
import { cleanText, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";

// The steel tracker (/todo/steel, the office only; lib/expenses/steel.ts says what and why): the tons bent and
// installed are logged here, one entry a time (where, what part, how many tons); the steel bought and what the
// steel benders were paid come from the expenses as they are.

export type { SteelData };

const ID_RE = new RegExp(`^${STEEL_INSTALL_PREFIX}[a-f0-9]{12}$`);

async function listInstalls(): Promise<SteelInstall[]> {
  return getBuyersClient().fetch<SteelInstall[]>(
    `*[_type == "steelInstall" && string::startsWith(_id, $prefix)] | order(date desc){ "id": _id, date, area, part, tons, "note": coalesce(note, ""), "createdBy": coalesce(createdBy, ""), createdAt }`,
    { prefix: STEEL_INSTALL_PREFIX }
  );
}

export async function steelData(me: TodoMe): Promise<SteelData> {
  const [expenses, store, rate, installs, books] = await Promise.all([listExpenses(), getStore(me), steelRate(), listInstalls(), cachedBookLists().catch(() => ({ locations: [] }))]);
  const units = new Map(store.items.map((i) => [i.name.trim().toLowerCase(), i.unit]));
  const summary = steelSummary(expenses, rate, (m) => units.get(m.trim().toLowerCase()) ?? null);
  return { tracker: steelTracker(summary, installs), areas: areasWith(FLOORS, books.locations).filter((a) => a !== "Whole building") };
}

/** Tons installed: a new entry, or one changed (`id`). */
async function saveInstall(me: TodoMe, body: Record<string, unknown>): Promise<void> {
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && !Number.isNaN(Date.parse(`${body.date}T00:00:00Z`)) ? body.date : "";
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (!date || date > tomorrow || date < "2024-01-01") throw new TodoError(400, "Pick the day it was installed.");
  const area = cleanText(body.area, 60, "floor");
  if (!area) throw new TodoError(400, "Pick the floor or area.");
  const part = cleanText(body.part, 40, "part");
  if (!part) throw new TodoError(400, `Pick what was installed (${STEEL_PARTS.slice(0, 4).join(", ")}...).`);
  const tons = Math.round(Number(body.tons) * 1000) / 1000;
  if (!(tons > 0 && tons <= 500)) throw new TodoError(400, "Type the tons installed, e.g. 4.5.");
  const note = cleanText(body.note, 200, "note");
  const client = getBuyersClient();
  const fields = { date, area, part, tons, note, updatedAt: new Date().toISOString(), updatedBy: me.name };
  if (body.id !== undefined) {
    if (typeof body.id !== "string" || !ID_RE.test(body.id)) throw new TodoError(404, "That entry isn't there any more.");
    // Deleted on another phone meanwhile: say so (the change itself would fail with no reason given).
    if (!(await client.fetch<number>(`count(*[_id == $id])`, { id: body.id }))) throw new TodoError(404, "That entry isn't there any more.");
    await client.patch(body.id).set(fields).commit();
    return;
  }
  await client.create({ _id: STEEL_INSTALL_PREFIX + randomBytes(6).toString("hex"), _type: "steelInstall", ...fields, createdAt: fields.updatedAt, createdBy: me.name });
}

/**
 * The steel page's changes: { action: "install" } a new entry or a change (with id), "delete" one, "rate" the
 * labour a ton, "tons" an expense's tons (lib/expenses/server.ts setSteel). Answers with the tracker as it is now.
 */
export async function changeSteel(me: TodoMe, body: Record<string, unknown>): Promise<SteelData> {
  if (body.action === "install") await saveInstall(me, body);
  else if (body.action === "delete") {
    if (typeof body.id !== "string" || !ID_RE.test(body.id)) throw new TodoError(404, "That entry isn't there any more.");
    await getBuyersClient().delete(body.id);
  } else if (body.action === "rate") await setSteel({ rate: body.rate });
  else if (body.action === "tons") await setSteel({ id: body.id, tons: body.tons });
  else throw new TodoError(400, "That button isn't known.");
  return steelData(me);
}
