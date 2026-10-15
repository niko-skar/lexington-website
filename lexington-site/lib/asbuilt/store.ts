import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";

import seed from "./seed.json";
import type { Floor } from "./types";

/**
 * Where the as-built record lives: one document per floor in the PRIVATE
 * buyers dataset (`asbuiltFloor`, id `asbuilt-floor-<key>`), holding the
 * drawing values, what was measured, and a log of every change. Everything
 * outside production (a preview, a local copy) uses `asbuilt-dev-floor-*`, so
 * testing never touches the real record.
 *
 * A floor that doesn't exist yet is created from the drawings (seed.json) the
 * first time the page opens. After that the documents are the record: the
 * seed is never written over them.
 */

export const SEED_FLOORS = (seed as unknown as { version: number; floors: Omit<Floor, "_id">[] }).floors;
const SEED_VERSION = (seed as { version: number }).version;

/** How many recent changes the page gets per floor (the export has them all). */
export const RECENT_LOG = 300;

export function isRealRecord(): boolean {
  return process.env.VERCEL_ENV === "production";
}

export function floorId(key: string): string {
  return `${isRealRecord() ? "asbuilt-floor-" : "asbuilt-dev-floor-"}${key}`;
}

export function isFloorKey(key: string): boolean {
  return SEED_FLOORS.some((f) => f.key === key);
}

const FLOOR_FIELDS = `..., "log": log[-${RECENT_LOG}..-1]`;
const FLOORS_QUERY = `*[_type == "asbuiltFloor" && _id in $ids]{${FLOOR_FIELDS}} | order(order asc)`;
const FLOOR_QUERY = `*[_type == "asbuiltFloor" && _id == $id][0]{${FLOOR_FIELDS}}`;

/** Every floor for the page (recent changes only), creating any that don't exist yet. */
export async function readFloors(): Promise<Floor[]> {
  const client = getBuyersClient();
  const ids = SEED_FLOORS.map((f) => floorId(f.key));
  const docs = await client.fetch<Floor[]>(FLOORS_QUERY, { ids });
  const missing = SEED_FLOORS.filter((f) => !docs.some((d) => d._id === floorId(f.key)));
  if (!missing.length) return docs;

  const created = missing.map((f) => ({
    ...f,
    _id: floorId(f.key),
    _type: "asbuiltFloor",
    seedVersion: SEED_VERSION,
    log: [],
  }));
  const tx = client.transaction();
  for (const doc of created) tx.createIfNotExists(doc);
  await tx.commit({ visibility: "sync" });
  // Not fetched again: an identical query in the same render would be answered
  // from the first (empty) one, so hand back what was just created.
  return [...docs, ...(created as Floor[])].sort((a, b) => a.order - b.order);
}

/** One floor for the page (recent changes only). */
export async function readFloorForPage(key: string): Promise<Floor | null> {
  return getBuyersClient().fetch<Floor | null>(FLOOR_QUERY, { id: floorId(key) });
}

/**
 * One floor in full, with its whole change log. `attempt` makes a second read
 * a different request, so it is never answered from the first one.
 */
export async function readFloorFull(key: string, attempt = 0): Promise<Floor | null> {
  return getBuyersClient().fetch<Floor | null>(`*[_id == $id][0]`, { id: floorId(key), attempt });
}

/** Every floor in full, for the download. */
export async function readAllFloorsFull(): Promise<Floor[]> {
  const ids = SEED_FLOORS.map((f) => floorId(f.key));
  return getBuyersClient().fetch<Floor[]>(`*[_type == "asbuiltFloor" && _id in $ids] | order(order asc)`, { ids });
}
