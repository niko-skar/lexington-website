"use server";

import { isFloorKey } from "@/lib/asbuilt/store";
import { getAdminSession } from "@/lib/auth/session";
import { planId, readPlan } from "@/lib/plans/store";
import {
  SPACE_TYPES,
  WALL_KINDS,
  type Anchor,
  type OpeningKind,
  type PlanContent,
  type PlanOpening,
  type PlanOption,
  type PlanPoint,
  type PlanWall,
  type SpaceLabel,
  type UnitTarget,
} from "@/lib/plans/types";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

export type PlanResult =
  | { ok: true; plan: PlanOption }
  | { ok: false; error: string; newer?: PlanOption };

export interface SavePlanInput {
  floorKey: string;
  option: string;
  /** The version the editor started from; a newer one saved elsewhere is not written over. */
  rev?: string | null;
  /** Write over a newer version anyway (after the editor asked). */
  force?: boolean;
  content: PlanContent;
}

const OPTION_RE = /^[a-z0-9]{1,8}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const REF_RE = /^(?:[A-Za-z0-9]{1,6}|e:[A-Za-z0-9_-]{1,40}|c:(?:columns|cores):[A-Za-z0-9_-]{1,40}:[lrtb])$/;
const OPENING_KINDS: OpeningKind[] = ["door", "double", "slider", "window"];
const MAX = { walls: 800, openings: 800, labels: 400, targets: 120 };

class Refused extends Error {}

function num(v: unknown, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Refused("A number in the plan doesn't look right.");
  return Math.round(v * 10) / 10;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function key(v: unknown): string {
  if (typeof v !== "string" || !KEY_RE.test(v)) throw new Refused("Something in the plan can't be saved. Reload the page.");
  return v;
}

function anchor(v: unknown): Anchor {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o.ref !== "string" || !REF_RE.test(o.ref)) throw new Refused("A wall isn't hung on the grid. Reload the page.");
  return { ref: o.ref, d: num(o.d, -100_000, 100_000) };
}

function point(v: unknown): PlanPoint {
  const o = (v ?? {}) as Record<string, unknown>;
  return { x: anchor(o.x), y: anchor(o.y) };
}

function clean(content: PlanContent): PlanContent {
  if (!content || typeof content !== "object") throw new Refused("Nothing to save.");
  const walls = Array.isArray(content.walls) ? content.walls : [];
  const openings = Array.isArray(content.openings) ? content.openings : [];
  const labels = Array.isArray(content.labels) ? content.labels : [];
  const targets = Array.isArray(content.targets) ? content.targets : [];
  if (walls.length > MAX.walls || openings.length > MAX.openings || labels.length > MAX.labels || targets.length > MAX.targets)
    throw new Refused("The plan is too big to save.");
  const kinds = WALL_KINDS.map((k) => k.kind);
  const cleanWalls: PlanWall[] = walls.map((w) => ({
    _key: key(w._key),
    a: point(w.a),
    b: point(w.b),
    kind: kinds.includes(w.kind) ? w.kind : "partition",
    t: num(w.t, 10, 1000),
  }));
  const wallKeys = new Set(cleanWalls.map((w) => w._key));
  const cleanOpenings: PlanOpening[] = openings
    .filter((o) => o && wallKeys.has(o.wall))
    .map((o) => ({
      _key: key(o._key),
      wall: o.wall,
      at: num(o.at, -100_000, 100_000),
      w: num(o.w, 100, 10_000),
      kind: OPENING_KINDS.includes(o.kind) ? o.kind : "door",
      ...(o.flip ? { flip: true } : {}),
      ...(o.hand ? { hand: true } : {}),
    }));
  const types = SPACE_TYPES.map((s) => s.type);
  const cleanLabels: SpaceLabel[] = labels.map((l) => ({
    _key: key(l._key),
    at: point(l.at),
    name: str(l.name, 60) || "Room",
    type: types.includes(l.type) ? l.type : "other",
    unit: str(l.unit, 20) || null,
  }));
  const cleanTargets: UnitTarget[] = targets
    .filter((t) => t && str(t.unit, 20))
    .map((t) => ({ _key: key(t._key), unit: str(t.unit, 20), stated: num(t.stated, 1, 5000) }));
  return { name: str(content.name, 40) || "A", walls: cleanWalls, openings: cleanOpenings, labels: cleanLabels, targets: cleanTargets };
}

function isRevisionClash(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: string };
  return e?.statusCode === 409 || /revision/i.test(e?.message ?? "");
}

/**
 * Saves one layout option of one floor. The first save of a day also keeps a copy of how the plan
 * stood before it (`<id>-day-YYYY-MM-DD`), so any day's work can be got back.
 */
export async function savePlanAction(input: SavePlanInput): Promise<PlanResult> {
  if (!(await getAdminSession())) return { ok: false, error: "Your sign-in has run out. Sign in again, then save once more." };
  if (!input || !isFloorKey(input.floorKey) || !OPTION_RE.test(input.option ?? "")) return { ok: false, error: "That floor or option isn't known." };
  let content: PlanContent;
  try {
    content = clean(input.content);
  } catch (err) {
    if (err instanceof Refused) return { ok: false, error: err.message };
    throw err;
  }

  const client = getBuyersClient();
  const id = planId(input.floorKey, input.option);
  const current = await readPlan(input.floorKey, input.option);
  if (current && input.rev && current._rev !== input.rev && !input.force)
    return { ok: false, error: "This layout was changed on another screen.", newer: current };

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tx = client.transaction();
  if (current && (current.updatedAt ?? "").slice(0, 10) !== today) {
    const { _rev, ...before } = current;
    void _rev;
    tx.createOrReplace({ ...before, _id: `${id}-day-${(current.updatedAt ?? today).slice(0, 10)}`, _type: "floorPlanOption", snapshotOf: id });
  }
  const doc = {
    _id: id,
    _type: "floorPlanOption",
    floorKey: input.floorKey,
    option: input.option,
    ...content,
    createdAt: current?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
  if (current && !input.force && input.rev) tx.patch(id, (p) => p.ifRevisionId(input.rev as string).set(doc));
  else tx.createOrReplace(doc);
  try {
    await tx.commit({ visibility: "sync" });
  } catch (err) {
    if (isRevisionClash(err)) {
      const newer = await readPlan(input.floorKey, input.option, 1);
      return { ok: false, error: "This layout was changed on another screen.", newer: newer ?? undefined };
    }
    console.error("floor plan save failed", err);
    return { ok: false, error: "Couldn't save just now. Check the connection; it tries again by itself." };
  }
  const fresh = await readPlan(input.floorKey, input.option, 2);
  return fresh ? { ok: true, plan: fresh } : { ok: false, error: "Saved, but couldn't read it back. Reload the page." };
}

/** Deletes a layout option (its daily copies stay, so it can be got back). */
export async function deletePlanAction(floorKey: string, option: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await getAdminSession())) return { ok: false, error: "Your sign-in has run out." };
  if (!isFloorKey(floorKey) || !OPTION_RE.test(option)) return { ok: false, error: "That option isn't known." };
  const current = await readPlan(floorKey, option);
  if (!current) return { ok: true };
  const client = getBuyersClient();
  const id = planId(floorKey, option);
  const { _rev, ...before } = current;
  void _rev;
  await client
    .transaction()
    .createOrReplace({ ...before, _id: `${id}-deleted-${new Date().toISOString().slice(0, 10)}`, _type: "floorPlanOption", snapshotOf: id })
    .delete(id)
    .commit({ visibility: "sync" });
  return { ok: true };
}
