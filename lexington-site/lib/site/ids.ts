import "server-only";
import { randomBytes } from "node:crypto";

// The expenses and the store room live in the PRIVATE buyers dataset (never the public website
// one, which anyone can list). Live documents carry "-live-" in their id; a preview build or a
// laptop writes "-dev-" ones, so testing never mixes into the real records.
const TAG = process.env.VERCEL_ENV === "production" ? "live" : "dev";

export const EXPENSE_PREFIX = `expense-${TAG}-`;
export const ITEM_PREFIX = `storeitem-${TAG}-`;
export const MOVE_PREFIX = `storemove-${TAG}-`;
/** Tools (they go out each day and come back), each take-out, and the store room's opening and closing photos. */
export const TOOL_PREFIX = `storetool-${TAG}-`;
export const TOOL_OUT_PREFIX = `toolout-${TAG}-`;
export const CHECK_PREFIX = `storecheck-${TAG}-`;
/** The running numbers behind the expense refs (EXP-0001, IN-0001). */
export const EXPENSE_COUNTER_ID = `expensecounter-${TAG}`;
/** Deleted entries still to be marked "Deleted" on the Google Sheet. */
export const SHEET_DELETION_PREFIX = `expensegone-${TAG}-`;
/** Small settings for the expenses (the Google Sheet's address once it has answered). */
export const EXPENSE_SETTINGS_ID = `expensesettings-${TAG}`;
/** How site expenses go into QuickBooks (accounts, start date, on/off). */
export const QBO_FEED_ID = `qbofeed-${TAG}`;
/** Entries already in QuickBooks that then left the app (deleted, or no longer a Site entry): to remove there by hand. */
export const QBO_GONE_PREFIX = `qbogone-${TAG}-`;

export const newId = (prefix: string) => prefix + randomBytes(6).toString("hex");

/** New ids end in 12 hex; expenses brought over from the old Claude page keep its 20-letter ids. */
export const isId = (prefix: string, id: unknown): id is string =>
  typeof id === "string" && id.startsWith(prefix) && /^[a-z0-9]{12,24}$/.test(id.slice(prefix.length));
