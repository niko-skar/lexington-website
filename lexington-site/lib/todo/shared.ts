// The site to-do list (/todo): what an item looks like, shared by the server and the phone page.
// Niko (22 Oct 2026): "a to do list for the construction where I can take a picture of something
// on the site and leave a comment, then share only that page with my foreman who can tick off
// when things are done" -- an app on his iPhone and the foreman's Android, both live at once.

/** Floors as the as-built record names them (ground to 7th, then the roof), plus the yard. */
export const AREAS = ["Ground", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "Roof", "Outside"] as const;
export type Area = (typeof AREAS)[number];

export const areaLabel = (area: string | null | undefined) =>
  !area ? "No floor given" : area === "Ground" ? "Ground floor" : area === "Roof" || area === "Outside" ? area : `${area} floor`;

/** Two lists: the site (shared with the foreman) and the house (the office only, never shown to a site login). */
export const LISTS = ["site", "house"] as const;
export type TodoList = (typeof LISTS)[number];
export const listLabel = (list: TodoList) => (list === "house" ? "House to-do" : "Site to-do");

export const MAX_TEXT = 600;
export const MAX_NOTE = 300;

export interface TodoTask {
  id: string;
  /** Jobs saved before the house list existed have no list: they are site jobs. */
  list: TodoList;
  text: string;
  area: string | null;
  urgent: boolean;
  status: "open" | "done";
  createdAt: string;
  createdBy: string;
  /** Who added it: "office", or a site login's account id (they may change or delete their own). */
  createdById: string | null;
  photoUrl: string | null;
  doneAt: string | null;
  doneBy: string | null;
  doneNote: string | null;
  /** A photo of the finished work, taken when (or after) it was ticked. */
  fixUrl: string | null;
  updatedAt: string;
}

/**
 * The parts of the site app (one home-screen app that opens on its home page, 30 Oct 2026). The office
 * opens all of them; a site login opens what the office ticked for it (Niko: "I can change or add or
 * remove as I please"), and never the expenses (money) or the alerts (Niko's enquiries, leads and
 * messages). To-do, Store, Expenses and Alerts are drawn in the one page; the roll call's three parts
 * (Today, Payday, Workers) are its own page, /todo/rollcall (lib/rollcall).
 */
export const SECTIONS = ["todo", "store", "expenses", "alerts", "rollcall", "payday", "workers", "concrete", "buyers", "steel", "suppliers", "spending", "orders", "cashflow", "analysis", "asbuilt"] as const;
export type Section = (typeof SECTIONS)[number];
/**
 * Concrete (the trucks on pour days, lib/concrete, 30 Oct 2026), Buyers (their payments and receipts,
 * lib/buyers, the office only, 31 Oct 2026) and Steel (the tons bought and installed, and what the steel
 * benders are owed, lib/steel, the office only, 2 Nov 2026) and Suppliers (QuickBooks' suppliers and their bills,
 * lib/suppliers, the office only, 2 Nov 2026) and Spending (QuickBooks' transactions with the app's own, by cost type,
 * floor, supplier and month, lib/spending, the office only, 3 Nov 2026) are drawn in the one page too, and so are the
 * purchase orders (lib/orders) and the cash flow (lib/cashflow), the office only, 5 Nov 2026, and the analysis (how
 * the money's going and every material bought, counted, lib/analysis, the office only, 7 Nov 2026). The as-built
 * record (every floor as drawn and as measured, lib/asbuilt, the office only) moved in from the admin pages on
 * 10 Nov 2026 (Niko: "put the as build dimensions for the building onto the app as well").
 */
export const PAGE_SECTIONS = ["todo", "store", "expenses", "alerts", "concrete", "buyers", "steel", "asbuilt", "suppliers", "spending", "orders", "cashflow", "analysis"] as const;
export type PageSection = (typeof PAGE_SECTIONS)[number];
export const isPageSection = (section: string): section is PageSection => (PAGE_SECTIONS as readonly string[]).includes(section);
/**
 * Finance (Niko, 5 Nov 2026: "turn expenses into finance and house everything finance related in there"): one place
 * on the bar for the money parts, each a tab of it, in this order.
 */
export const FINANCE_SECTIONS = ["expenses", "orders", "suppliers", "cashflow", "spending", "analysis", "buyers"] as const;
export type FinanceSection = (typeof FINANCE_SECTIONS)[number];
export const isFinance = (section: string): section is FinanceSection => (FINANCE_SECTIONS as readonly string[]).includes(section);
export type SiteSection = Exclude<Section, "expenses" | "alerts" | "buyers" | "steel" | "suppliers" | "spending" | "orders" | "cashflow" | "analysis" | "asbuilt">;
export const SITE_SECTIONS: readonly SiteSection[] = ["todo", "store", "rollcall", "payday", "workers", "concrete"];
const HREF: Record<Section, string> = {
  todo: "/todo/jobs",
  store: "/todo/store",
  expenses: "/todo/expenses",
  alerts: "/todo/alerts",
  rollcall: "/todo/rollcall#today",
  payday: "/todo/rollcall#week",
  workers: "/todo/rollcall#workers",
  concrete: "/todo/concrete",
  buyers: "/todo/buyers",
  steel: "/todo/steel",
  suppliers: "/todo/suppliers",
  spending: "/todo/spending",
  orders: "/todo/orders",
  cashflow: "/todo/cashflow",
  analysis: "/todo/analysis",
  asbuilt: "/todo/asbuilt",
};
export const sectionHref = (section: Section) => HREF[section];
const SECTION_NAMES: Record<Section, string> = {
  todo: "To-do",
  store: "Store",
  expenses: "Expenses",
  alerts: "Alerts",
  rollcall: "Roll call",
  payday: "Payday",
  workers: "Workers",
  concrete: "Concrete",
  buyers: "Buyers",
  steel: "Steel",
  suppliers: "Suppliers",
  spending: "Spending",
  orders: "Orders",
  cashflow: "Cash flow",
  analysis: "Analysis",
  asbuilt: "As-built",
};
export const sectionName = (section: Section) => SECTION_NAMES[section];
/** Where a sign-in from the app may send someone back to. */
export const APP_PAGES: readonly string[] = [
  "/todo",
  "/todo/jobs",
  "/todo/store",
  "/todo/expenses",
  "/todo/alerts",
  "/todo/rollcall",
  "/todo/concrete",
  "/todo/buyers",
  "/todo/steel",
  "/todo/suppliers",
  "/todo/spending",
  "/todo/orders",
  "/todo/cashflow",
  "/todo/analysis",
  "/todo/asbuilt",
];

/** Who is using the page: Niko and other admins add and delete; a "site" login (the foreman) ticks. */
export interface TodoMe {
  kind: "admin" | "site";
  /** The site login's account id; "office" for the office. */
  id: string;
  name: string;
  sections: Section[];
}

export interface SiteAccount {
  id: string;
  name: string;
  email: string;
  sections: SiteSection[];
}

/** A smaller copy of a stored photo from Sanity's image CDN (it resizes on the fly); the phone's own copy of one still uploading as it is. */
export const photoAt = (url: string, width: number) => (url.startsWith("blob:") ? url : `${url}?w=${width}&fit=max&auto=format&q=72`);
