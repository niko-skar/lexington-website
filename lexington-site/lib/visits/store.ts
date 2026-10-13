import "server-only";
import { randomBytes } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";

import type { StoredEvent, StoredVisit } from "./report";
import { shiftDay, utcDay } from "./report";
import type { Browser, VisitBeacon } from "./rules";

/**
 * Where the visit record lives: one document a day in the PRIVATE buyers
 * dataset (`visitLog`, id `visit-log-YYYY-MM-DD`), holding that day's visits
 * (how each arrived) and events (what happened), so the record costs a few dozen
 * documents however busy the site is. Everything outside production (a preview,
 * a local copy) writes to `visit-log-dev-*` instead, so testing never mixes with
 * real visits. Documents older than 30 days are deleted by a daily job.
 *
 * Each beacon is one transaction: create the day's document if it is missing,
 * then append. No read comes first, so a beacon costs one request.
 */

const KEEP_DAYS = 30;

export function visitLogPrefix(): string {
  return process.env.VERCEL_ENV === "production" ? "visit-log-" : "visit-log-dev-";
}

export function visitLogId(day: string): string {
  return `${visitLogPrefix()}${day}`;
}

function newKey(): string {
  return randomBytes(6).toString("hex");
}

export async function recordVisitBeacon(
  beacon: VisitBeacon,
  server: { country: string | null; browser: Browser },
  nowMs: number = Date.now()
): Promise<void> {
  const day = utcDay(nowMs);
  const id = visitLogId(day);
  const events: StoredEvent[] = beacon.events.map((event) => ({
    _key: newKey(),
    v: beacon.visit,
    at: new Date(nowMs - (event.agoMs ?? 0)).toISOString(),
    k: event.kind,
    p: event.path,
    ...(event.label ? { l: event.label } : {}),
    ...(event.amount != null ? { m: event.amount } : {}),
    ...(event.scroll != null ? { s: event.scroll } : {}),
    ...(event.detail ? { x: event.detail } : {}),
  }));

  const client = getBuyersClient();
  let tx = client
    .transaction()
    .createIfNotExists({ _id: id, _type: "visitLog", day, visits: [], events: [] })
    .patch(id, (patch) => patch.setIfMissing({ visits: [], events: [] }).append("events", events));

  if (beacon.first && beacon.context) {
    const firstAt = events.reduce((earliest, event) => (event.at < earliest ? event.at : earliest), new Date(nowMs).toISOString());
    const visit: StoredVisit = {
      _key: newKey(),
      v: beacon.visit,
      at: firstAt,
      src: beacon.context.kind,
      ...(beacon.context.label ? { label: beacon.context.label } : {}),
      ...(beacon.context.campaign ? { campaign: beacon.context.campaign } : {}),
      device: beacon.context.device,
      ...(server.country ? { country: server.country } : {}),
      browser: server.browser,
    };
    // A second patch, not a second append on the first: one patch holds one insert.
    tx = tx.patch(id, (patch) => patch.append("visits", [visit]));
  }

  await tx.commit({ visibility: "async", returnDocuments: false, autoGenerateArrayKeys: false });
}

/** The visits and events stored for some days. Never throws: a failure comes back as `error`. */
export async function readVisitLogs(days: readonly string[]): Promise<{ visits: StoredVisit[]; events: StoredEvent[]; error: string | null }> {
  try {
    const docs = await getBuyersClient().fetch<{ visits?: StoredVisit[]; events?: StoredEvent[] }[]>(
      `*[_type == "visitLog" && _id in $ids]{visits, events}`,
      { ids: days.map(visitLogId) }
    );
    const visits: StoredVisit[] = [];
    const events: StoredEvent[] = [];
    for (const doc of docs ?? []) {
      if (Array.isArray(doc.visits)) visits.push(...doc.visits);
      if (Array.isArray(doc.events)) events.push(...doc.events);
    }
    return { visits, events, error: null };
  } catch (error) {
    console.error("[visits] could not be read:", error instanceof Error ? error.message : "unknown");
    return { visits: [], events: [], error: error instanceof Error ? error.message : "unknown error" };
  }
}

/** Deletes the day documents older than 30 days (live and test ones alike). Returns how many went. */
export async function purgeOldVisitLogs(nowMs: number = Date.now()): Promise<number> {
  const client = getBuyersClient();
  const cutoff = shiftDay(utcDay(nowMs), -KEEP_DAYS);
  const ids = await client.fetch<string[]>(`*[_type == "visitLog" && day < $cutoff]._id`, { cutoff });
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const tx = client.transaction();
  for (const id of ids) tx.delete(id);
  await tx.commit();
  return ids.length;
}
