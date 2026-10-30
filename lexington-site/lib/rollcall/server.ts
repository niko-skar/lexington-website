import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { ROLLCALL_PREFIX } from "@/lib/site/ids";
import { getTodoUser, TodoError } from "@/lib/todo/server";
import type { TodoMe } from "@/lib/todo/shared";
import { opensRollcall, ROLLCALL_COLLECTIONS, rollcallAccess, type RollcallAccess, type RollcallCollection, type RollcallDoc } from "./shared";

// The roll call's records in the PRIVATE buyers dataset: one document per page record, its data kept whole as
// JSON (worker ids and dates are its keys, which Sanity won't take as field names). Saving merges the change
// into what is there, as the page's old database did, with a revision check, so two phones marking at once
// both land. Each login gets only what its parts allow: no payments without Payday; no wage rates or special
// rates without Payday; no phone numbers, MoMo or ID photos without Workers or Payday.

type Data = Record<string, unknown>;
type Row = { col: RollcallCollection; key: string; json: string; rev: string; at: string };

const MAX_DOC = 400_000;
const KEY_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const docId = (col: RollcallCollection, key: string) => `${ROLLCALL_PREFIX}${col}--${key}`;
const isObj = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The page's own merge: objects merge field by field; anything else (null too) replaces. */
export function deepMerge(target: Data, patch: Data): Data {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    target[k] = isObj(v) ? deepMerge(isObj(target[k]) ? (target[k] as Data) : {}, v) : v;
  }
  return target;
}

function checkKeys(value: unknown, depth = 0): void {
  if (depth > 12) throw new TodoError(400, "That change is nested too deeply.");
  if (Array.isArray(value)) value.forEach((v) => checkKeys(v, depth + 1));
  else if (isObj(value))
    for (const [k, v] of Object.entries(value)) {
      if (BAD_KEYS.has(k)) throw new TodoError(400, "That change can't be saved.");
      checkKeys(v, depth + 1);
    }
}

function parsePath(path: unknown): [RollcallCollection, string] {
  const [col, key, extra] = typeof path === "string" ? path.split("/") : [];
  if (extra !== undefined || !(ROLLCALL_COLLECTIONS as readonly string[]).includes(col) || !KEY_RE.test(key ?? "")) {
    throw new TodoError(400, "That record doesn't exist.");
  }
  return [col as RollcallCollection, key];
}

/* ---------- who may see what ---------- */

// Without Payday, only the rates Today itself needs (a machine's day, curing): never a wage.
const TODAY_RATES = ["bendMachine", "cutMachine", "curing", "curingDry"];

function viewOf(can: RollcallAccess, col: RollcallCollection, data: Data): Data | null {
  switch (col) {
    case "payments":
      return can.payday ? data : null;
    case "days":
    case "pours":
      return can.rollcall || can.payday ? data : null;
    case "checklists":
      return can.rollcall || can.workers ? data : null;
    case "workers": {
      const out = { ...data };
      if (!can.payday) delete out.rate;
      if (!can.payday && !can.workers) for (const k of ["phone", "momo", "momoName", "idPhoto"]) delete out[k];
      return out;
    }
    case "config": {
      if (can.payday) return data;
      const out = { ...data };
      delete out.otRate;
      if (isObj(out.rates)) out.rates = Object.fromEntries(Object.entries(out.rates).filter(([k]) => TODAY_RATES.includes(k)));
      return out;
    }
  }
}

const WRITE_KEYS: Record<RollcallCollection, readonly string[]> = {
  days: ["date", "marks", "ot", "machines", "pay"],
  payments: ["weekStart", "paid", "waived"],
  workers: ["name", "nick", "trade", "active", "created", "phone", "momo", "momoName", "rate", "idPhoto"],
  pours: ["what", "start", "days", "rate", "dryFine", "worker", "dry", "stopped", "deleted", "created", "phase", "planned", "check", "poured"],
  checklists: ["name", "n", "items", "created", "deleted"],
  config: ["start", "lunchStart", "afternoon", "close", "satClose", "grace", "otRate", "curingDays", "rates"],
};

/** What this login may save of a change (a wage rate from a login without Payday is dropped, never saved). */
function allowWrite(can: RollcallAccess, col: RollcallCollection, key: string, change: Data): Data {
  const unknown = Object.keys(change).filter((k) => !WRITE_KEYS[col].includes(k));
  if (unknown.length) throw new TodoError(400, `That can't be saved here (${unknown.join(", ")}).`);
  const refuse = () => new TodoError(403, "This login can't change that. Ask the office.");
  switch (col) {
    case "days": {
      const marking = Object.keys(change).some((k) => k !== "pay" && k !== "date");
      if (("pay" in change && !can.payday) || (marking && !can.rollcall) || (!can.rollcall && !can.payday)) throw refuse();
      return change;
    }
    case "payments":
      if (!can.payday) throw refuse();
      return change;
    case "workers": {
      if (!can.workers) throw refuse();
      if (can.payday) return change;
      const rest = { ...change };
      delete rest.rate;
      return rest;
    }
    case "pours":
      if (!can.rollcall) throw refuse();
      return change;
    case "checklists":
      if (!can.workers) throw refuse();
      return change;
    case "config":
      if (key !== "settings" || !can.payday) throw refuse();
      return change;
  }
}

const toDoc = (can: RollcallAccess, row: Row): RollcallDoc | null => {
  const data = viewOf(can, row.col, JSON.parse(row.json) as Data);
  return data ? { col: row.col, key: row.key, data, rev: row.rev, at: row.at } : null;
};

/* ---------- the API's side ---------- */

/** The signed-in person, if they open any part of the roll call. */
export async function requireRollcallUser(): Promise<TodoMe> {
  const me = await getTodoUser();
  if (!me) throw new TodoError(401, "You've been signed out. Open the app again to sign in.");
  if (!opensRollcall(me.sections)) throw new TodoError(403, "This login doesn't open the roll call. Ask the office.");
  return me;
}

/** Everything this login may see, or what changed since a moment (a record seen again is skipped by the page). */
export async function readRollcall(me: TodoMe, since?: string | null): Promise<RollcallDoc[]> {
  const can = rollcallAccess(me.sections);
  const rows = since
    ? await getBuyersClient().fetch<Row[]>(
        `*[_type == "rollcallDoc" && string::startsWith(_id, $prefix) && dateTime(_updatedAt) >= dateTime($since)]{ col, key, json, "rev": _rev, "at": _updatedAt }`,
        { prefix: ROLLCALL_PREFIX, since }
      )
    : await getBuyersClient().fetch<Row[]>(`*[_type == "rollcallDoc" && string::startsWith(_id, $prefix)]{ col, key, json, "rev": _rev, "at": _updatedAt }`, {
        prefix: ROLLCALL_PREFIX,
      });
  return rows.map((row) => toDoc(can, row)).filter((d): d is RollcallDoc => !!d);
}

/**
 * Saves a change to one record. "update" merges it into a record that must exist; "set" makes the record, or
 * merges into it when another phone made it a moment before (so a new day marked on two phones keeps both).
 */
export async function writeRollcall(me: TodoMe, path: unknown, op: "set" | "update", change: unknown): Promise<RollcallDoc> {
  const [col, key] = parsePath(path);
  if (!isObj(change)) throw new TodoError(400, "Nothing to save.");
  checkKeys(change);
  const can = rollcallAccess(me.sections);
  const allowed = allowWrite(can, col, key, change);
  const client = getBuyersClient();
  const id = docId(col, key);
  for (let attempt = 0; ; attempt++) {
    const current = await client.fetch<{ _rev: string; json: string } | null>(`*[_id == $id][0]{ _rev, json }`, { id });
    if (!current && op === "update") throw new TodoError(404, "That record isn't there any more. Close the app and open it again.");
    const next = deepMerge(current ? (JSON.parse(current.json) as Data) : {}, structuredClone(allowed));
    const json = JSON.stringify(next);
    if (json.length > MAX_DOC) throw new TodoError(413, "That's too much to save in one go.");
    try {
      if (current) await client.patch(id).ifRevisionId(current._rev).set({ json, by: me.name }).commit();
      else await client.create({ _id: id, _type: "rollcallDoc", col, key, json, by: me.name });
      break;
    } catch (error) {
      // Another phone saved this record in between: read it again and merge on top.
      if ((error as { statusCode?: number }).statusCode === 409 && attempt < 6) {
        await sleep(80 + Math.random() * 220);
        continue;
      }
      throw error;
    }
  }
  const row = await client.fetch<Row | null>(`*[_id == $id][0]{ col, key, json, "rev": _rev, "at": _updatedAt }`, { id });
  const doc = row && toDoc(can, row);
  if (!doc) throw new TodoError(502, "It was saved but couldn't be read back. Close the app and open it again.");
  return doc;
}

/** The images store's address for this dataset (the page builds a photo's address from its id). */
export const photoBase = () => `https://cdn.sanity.io/images/${process.env.NEXT_PUBLIC_SANITY_PROJECT_ID}/${process.env.NEXT_PUBLIC_SANITY_BUYERS_DATASET}/`;
