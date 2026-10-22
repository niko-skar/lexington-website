"use server";

import { randomBytes } from "node:crypto";

import { getAt, getItem, parsePath, type ParsedPath } from "@/lib/asbuilt/paths";
import { floorId, isFloorKey, readFloorForPage, readFloorFull } from "@/lib/asbuilt/store";
import type { Change, EdgeFigure, Floor, LogEntry, OpeningEl, OpeningKind } from "@/lib/asbuilt/types";
import { getAdminSession } from "@/lib/auth/session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

export type AsBuiltResult = { ok: true; floor: Floor } | { ok: false; error: string };

export interface AsBuiltInput {
  floor: string;
  changes: Change[];
  /** What happened, in words, for the history ("C1 at D/3 measured"). */
  text: string;
  /** The element it was about, for that element's own history. */
  el?: string;
  /** Set when undoing: the history entry being undone. */
  undoOf?: string;
}

const MAX_CHANGES = 80;
// The full log stays in the document; past this the oldest entries go, so the
// document can never grow without end (thousands of edits a floor is plenty).
const MAX_LOG = 5000;
const KINDS: OpeningKind[] = ["void", "duct", "stair", "pool"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ADDED_KEY_RE = /^v[a-z0-9]{6,16}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

class Refused extends Error {}

const fail = (error: string): AsBuiltResult => ({ ok: false, error });
const newKey = () => randomBytes(6).toString("hex");

function num(v: unknown, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > max)
    throw new Refused("That number doesn't look right.");
  return Math.round(v * 10) / 10;
}

function text(v: unknown, max: number): string {
  if (typeof v !== "string") throw new Refused("That text doesn't look right.");
  return v.trim().slice(0, max);
}

function faces(v: unknown, withWall: boolean) {
  if (!v || typeof v !== "object") throw new Refused("Those measurements don't look right.");
  const o = v as Record<string, unknown>;
  const out = { l: num(o.l, 60000), r: num(o.r, 60000), t: num(o.t, 60000), b: num(o.b, 60000) };
  if (out.r - out.l < 20 || out.b - out.t < 20)
    throw new Refused("A face is on the wrong side: check left/right and above/below.");
  if (out.r - out.l > 30000 || out.b - out.t > 30000) throw new Refused("That size is too big. Check the numbers.");
  if (!withWall) return out;
  const wall = num(o.wall, 2000);
  if (wall < 50 || wall * 2 >= Math.min(out.r - out.l, out.b - out.t))
    throw new Refused("The wall thickness doesn't fit the core.");
  return { ...out, wall };
}

function isoDate(v: unknown): string {
  if (typeof v !== "string" || !ISO_RE.test(v) || Number.isNaN(Date.parse(v)))
    throw new Refused("That date doesn't look right.");
  return v;
}

function lineExists(floor: Floor, axis: "x" | "y", id: unknown): id is string {
  return typeof id === "string" && floor.grid.some((g) => g.axis === axis && g.id === id);
}

function cleanOpening(v: unknown, key: string, floor: Floor): OpeningEl {
  if (!v || typeof v !== "object") throw new Refused("That opening can't be added.");
  const o = v as Record<string, unknown>;
  if (o._key !== key || !ADDED_KEY_RE.test(key)) throw new Refused("That opening can't be added.");
  if (!lineExists(floor, "x", o.x) || !lineExists(floor, "y", o.y))
    throw new Refused("That opening isn't on this floor's grid.");
  const kind = KINDS.includes(o.kind as OpeningKind) ? (o.kind as OpeningKind) : "void";
  const note = typeof o.note === "string" ? o.note.trim().slice(0, 500) : "";
  return {
    _key: key,
    kind,
    name: (typeof o.name === "string" && o.name.trim().slice(0, 60)) || "Void",
    x: o.x,
    y: o.y,
    design: null,
    actual: faces(o.actual, false),
    added: true,
    at: isoDate(o.at),
    ...(note ? { note } : {}),
  };
}

/** Checks one change and returns the value to store (null = remove). */
function cleanValue(p: ParsedPath, value: unknown, floor: Floor, current: unknown): unknown {
  if (!p.field) {
    // A whole opening: add one made on site, or delete one that was added here.
    if (value === null) {
      if (!current) return null;
      if ((current as OpeningEl).added !== true)
        throw new Refused("Openings from the drawings can't be deleted: mark them as not built instead.");
      return null;
    }
    return cleanOpening(value, p.key, floor);
  }
  if (value === null || value === undefined) return null;
  switch (p.field) {
    case "shift":
      return num(value, 20000);
    case "measured":
    case "removed":
      if (typeof value !== "boolean") throw new Refused("That change doesn't look right.");
      return value || null;
    case "actual":
      return p.list === "slab.edges" ? num(value, 30000) : faces(value, p.list === "cores");
    case "at":
      return isoDate(value);
    case "note": {
      const t = text(value, 500);
      return t || null;
    }
    case "name": {
      const t = text(value, 60);
      if (!t) throw new Refused("Give it a name.");
      return t;
    }
    case "kind":
      if (!KINDS.includes(value as OpeningKind)) throw new Refused("That kind of opening isn't known.");
      return value;
    case "w":
    case "h": {
      const v = num(value, 30000);
      if (v < 50) throw new Refused("A column that small can't be right. Sizes are in mm: 31 cm is 310.");
      return v;
    }
    case "gx":
    case "gy": {
      const v = num(value, 40000);
      if (v < 0) throw new Refused("A gap can't be less than 0.");
      return v;
    }
    case "edges":
      return edgeFigures(value, floor);
  }
  return null;
}

/** A column's taped distances to the slab edges: each to an edge on this floor, at most one per edge. */
function edgeFigures(value: unknown, floor: Floor): EdgeFigure[] | null {
  if (!Array.isArray(value) || value.length > 8) throw new Refused("Those edge measurements don't look right.");
  const out: EdgeFigure[] = [];
  for (const item of value) {
    const o = (item ?? {}) as Record<string, unknown>;
    if (typeof o._key !== "string" || !KEY_RE.test(o._key)) throw new Refused("Those edge measurements don't look right.");
    if (typeof o.edge !== "string" || !floor.slab?.edges.some((e) => e._key === o.edge))
      throw new Refused("That slab edge isn't on this floor.");
    if (out.some((f) => f.edge === o.edge)) throw new Refused("One measurement per edge, please.");
    const d = num(o.d, 20000);
    if (d < 0) throw new Refused("A distance can't be less than 0.");
    out.push({ _key: o._key, edge: o.edge, d, ...(o.at ? { at: isoDate(o.at) } : {}) });
  }
  return out.length ? out : null;
}

function isRevisionClash(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: string };
  return e?.statusCode === 409 || /revision/i.test(e?.message ?? "");
}

/**
 * Saves a set of changes to one floor in one go, and logs them with what each
 * value was before, so any change can be undone from the history.
 */
export async function saveAsBuiltAction(input: AsBuiltInput): Promise<AsBuiltResult> {
  if (!(await getAdminSession())) return fail("Your sign-in has run out. Sign in again, then try once more.");
  if (!input || typeof input.floor !== "string" || !isFloorKey(input.floor)) return fail("That floor isn't known.");
  if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > MAX_CHANGES)
    return fail("Nothing to save.");
  const summary = typeof input.text === "string" ? input.text.trim().slice(0, 300) : "";
  if (!summary) return fail("Nothing to save.");
  const el = typeof input.el === "string" ? input.el.slice(0, 40) : undefined;
  const undoOf = typeof input.undoOf === "string" ? input.undoOf.slice(0, 40) : undefined;

  const client = getBuyersClient();
  const id = floorId(input.floor);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const doc = await readFloorFull(input.floor, attempt);
    if (!doc || !doc._rev) return fail("This floor isn't set up yet. Reload the page.");

    const entries: { path: string; p: ParsedPath; before: unknown; after: unknown }[] = [];
    try {
      for (const change of input.changes) {
        const p = change && typeof change.path === "string" ? parsePath(change.path) : null;
        if (!p) throw new Refused("That change can't be saved.");
        const item = getItem(doc, p.list, p.key);
        if (p.field && !item) throw new Refused("That item isn't on this floor any more. Reload the page.");
        const before = getAt(doc, change.path);
        entries.push({ path: change.path, p, before, after: cleanValue(p, change.value, doc, item) });
      }
    } catch (err) {
      if (err instanceof Refused) return fail(err.message);
      throw err;
    }

    const tx = client.transaction();
    tx.patch(id, (patch) => patch.ifRevisionId(doc._rev as string).setIfMissing({ log: [], openings: [] }));
    for (const e of entries) {
      if (e.after === null) {
        tx.patch(id, (patch) => patch.unset([e.path]));
      } else if (!e.p.field && !e.before) {
        tx.patch(id, (patch) => patch.insert("after", "openings[-1]", [e.after]));
      } else {
        tx.patch(id, (patch) => patch.set({ [e.path]: e.after }));
      }
    }
    const entry: LogEntry = {
      _key: newKey(),
      at: new Date().toISOString(),
      text: summary,
      ...(el ? { el } : {}),
      changes: JSON.stringify(entries.map((e) => ({ path: e.path, before: e.before ?? null, after: e.after ?? null }))),
      ...(undoOf ? { undoOf } : {}),
    };
    tx.patch(id, (patch) => patch.append("log", [entry]));
    const log = doc.log ?? [];
    const drop = log.length + 1 - MAX_LOG;
    if (drop > 0) {
      const oldest = log.slice(0, drop).map((l) => `log[_key=="${l._key}"]`);
      tx.patch(id, (patch) => patch.unset(oldest));
    }

    try {
      await tx.commit({ visibility: "sync" });
    } catch (err) {
      if (attempt === 0 && isRevisionClash(err)) continue;
      console.error("as-built save failed", err);
      return fail("Couldn't save just now. Check the connection and try again.");
    }
    const fresh = await readFloorForPage(input.floor);
    if (!fresh) return fail("Saved, but couldn't reload the floor. Reload the page.");
    return { ok: true, floor: fresh };
  }
  return fail("Someone else changed this floor at the same moment. Reload the page and try again.");
}
