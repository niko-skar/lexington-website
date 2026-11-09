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
/** A tool (or some of one) broken or needing repair: to send out, at the repairer, then fixed or written off (3 Nov 2026). */
export const TOOL_REPAIR_PREFIX = `toolrepair-${TAG}-`;
/** Something on the shopping list that isn't a store item at its reorder point (5 Nov 2026): one document each. */
export const BUY_PREFIX = `storebuy-${TAG}-`;
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
/** Each bank text the iPhone passed on (so one text never counts twice), and their settings (the link's version, the account). */
export const BANK_TEXT_PREFIX = `banktext-${TAG}-`;
export const BANK_TEXT_SETTINGS_ID = `banktexts-${TAG}`;
/** The site roll call (Nov 2026, moved in from its Claude page): one document per page record, "rc-live-days--2026-11-02". */
export const ROLLCALL_PREFIX = `rc-${TAG}-`;
/** Steel bent and installed (lib/steel): one document per entry of tons installed. */
export const STEEL_INSTALL_PREFIX = `steelinstall-${TAG}-`;
/** Suppliers' bills (lib/suppliers, 2 Nov 2026): one document per bill, and the running number behind BILL-0001.
 */
export const BILL_PREFIX = `bill-${TAG}-`;
export const BILL_COUNTER_ID = `billcounter-${TAG}`;
/** The company's suppliers as QuickBooks has them (its vendors), as last read (lib/quickbooks/vendors.ts). */
export const QBO_VENDORS_ID = `qbovendors-${TAG}`;
/** The company's QuickBooks classes and locations as last read (lib/quickbooks/booksCache.ts). */
export const QBO_LISTS_ID = `qbolists-${TAG}`;
/** Concrete deliveries (30 Oct 2026): one document per truck, and one per pour day ("concreteday-live-2026-10-30"). */
export const TRUCK_PREFIX = `concretetruck-${TAG}-`;
export const POUR_DAY_PREFIX = `concreteday-${TAG}-`;

/** QuickBooks' transactions read into the website for the Spending page (3 Nov 2026): one document a month, and how the last read went. */
export const QBO_TXN_MONTH_PREFIX = `qbotxns-${TAG}-`;
export const QBO_HISTORY_ID = `qbohistory-${TAG}`;
/** Lines from one of Niko's sheets waiting to go into QuickBooks at one tap (lib/quickbooks/catchup.ts, 7 Nov 2026): one document a sheet. */
export const QBO_CATCHUP_PREFIX = `qbocatchup-${TAG}-`;
/** A pour's pre-pour photos (one record each, the original in the private photo store) and its concrete cubes (3 Nov 2026). */
export const POUR_PHOTO_PREFIX = `pourphoto-${TAG}-`;
export const POUR_CUBES_PREFIX = `pourcubes-${TAG}-`;
/** A pour's worked-out concrete (what was picked and the m³) and its order to the concrete company (9 Nov 2026). */
export const POUR_ESTIMATE_PREFIX = `pourestimate-${TAG}-`;
/** A photo that landed after its record was saved (3 Nov 2026): which stored photo a phone's ticket became. */
export const PHOTO_TICKET_PREFIX = `phototicket-${TAG}-`;
/** Purchase orders (lib/orders, 5 Nov 2026): one document each, and the running number behind PO-0001. */
export const ORDER_PREFIX = `po-${TAG}-`;
export const ORDER_COUNTER_ID = `pocounter-${TAG}`;
/** The cash flow (lib/cashflow, 5 Nov 2026): the money as last typed and the weekly wages figure, and each plan typed. */
export const CASHFLOW_ID = `cashflow-${TAG}`;
export const CASH_PLAN_PREFIX = `cashplan-${TAG}-`;

export const newId = (prefix: string) => prefix + randomBytes(6).toString("hex");

/** New ids end in 12 hex; expenses brought over from the old Claude page keep its 20-letter ids. */
export const isId = (prefix: string, id: unknown): id is string =>
  typeof id === "string" && id.startsWith(prefix) && /^[a-z0-9]{12,24}$/.test(id.slice(prefix.length));
