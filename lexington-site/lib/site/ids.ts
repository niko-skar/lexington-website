import "server-only";
import { randomBytes } from "node:crypto";

// The expenses and the store room live in the PRIVATE buyers dataset (never the public website
// one, which anyone can list). Live documents carry "-live-" in their id; a preview build or a
// laptop writes "-dev-" ones, so testing never mixes into the real records.
const TAG = process.env.VERCEL_ENV === "production" ? "live" : "dev";

export const EXPENSE_PREFIX = `expense-${TAG}-`;
export const ITEM_PREFIX = `storeitem-${TAG}-`;
export const MOVE_PREFIX = `storemove-${TAG}-`;

export const newId = (prefix: string) => prefix + randomBytes(6).toString("hex");

/** New ids end in 12 hex; expenses brought over from the old Claude page keep its 20-letter ids. */
export const isId = (prefix: string, id: unknown): id is string =>
  typeof id === "string" && id.startsWith(prefix) && /^[a-z0-9]{12,24}$/.test(id.slice(prefix.length));
