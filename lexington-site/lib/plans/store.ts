import "server-only";

import { isRealRecord } from "@/lib/asbuilt/store";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

import type { PlanOption, PlanReference } from "./types";

/**
 * Where the floor plans live: one document per layout option per floor in the PRIVATE buyers dataset
 * (`floorPlanOption`, id `floorplan-live-<floor>-<option>`). Everything outside production (a
 * preview, a local copy) uses `floorplan-dev-*`, so trying things never touches the real plans.
 * Copies kept as restore points (the day's first save, a deleted option) carry `snapshotOf`.
 */

export function planPrefix(): string {
  return isRealRecord() ? "floorplan-live-" : "floorplan-dev-";
}

export function planId(floorKey: string, option: string): string {
  return `${planPrefix()}${floorKey}-${option}`;
}

const FIELDS = `_id, _rev, floorKey, option, name, walls, openings, labels, targets, updatedAt, createdAt`;

/** Every layout option of every floor. */
export async function readPlans(): Promise<PlanOption[]> {
  return getBuyersClient().fetch<PlanOption[]>(
    `*[_type == "floorPlanOption" && string::startsWith(_id, $prefix) && !defined(snapshotOf)] | order(floorKey asc, option asc){${FIELDS}}`,
    { prefix: planPrefix() },
  );
}

/** The architects' plans to trace over, one per floor where there is one. */
export async function readReferences(): Promise<PlanReference[]> {
  return getBuyersClient().fetch<PlanReference[]>(
    `*[_type == "floorPlanReference"]{ floorKey, title, "url": image.asset->url, w, h, pxPerPt, xs[]{ line, pt }, ys[]{ line, pt } }`,
  );
}

export async function readPlan(floorKey: string, option: string, attempt = 0): Promise<PlanOption | null> {
  return getBuyersClient().fetch<PlanOption | null>(`*[_id == $id][0]{${FIELDS}}`, { id: planId(floorKey, option), attempt });
}
