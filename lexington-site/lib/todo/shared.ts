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
export const SECTIONS = ["todo", "store", "expenses", "alerts", "rollcall", "payday", "workers"] as const;
export type Section = (typeof SECTIONS)[number];
export const PAGE_SECTIONS = ["todo", "store", "expenses", "alerts"] as const;
export type PageSection = (typeof PAGE_SECTIONS)[number];
export const isPageSection = (section: string): section is PageSection => (PAGE_SECTIONS as readonly string[]).includes(section);
export type SiteSection = Exclude<Section, "expenses" | "alerts">;
export const SITE_SECTIONS: readonly SiteSection[] = ["todo", "store", "rollcall", "payday", "workers"];
const HREF: Record<Section, string> = {
  todo: "/todo/jobs",
  store: "/todo/store",
  expenses: "/todo/expenses",
  alerts: "/todo/alerts",
  rollcall: "/todo/rollcall#today",
  payday: "/todo/rollcall#week",
  workers: "/todo/rollcall#workers",
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
};
export const sectionName = (section: Section) => SECTION_NAMES[section];
/** Where a sign-in from the app may send someone back to. */
export const APP_PAGES: readonly string[] = ["/todo", "/todo/jobs", "/todo/store", "/todo/expenses", "/todo/alerts", "/todo/rollcall"];

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

/** A smaller copy of a stored photo from Sanity's image CDN (it resizes on the fly). */
export const photoAt = (url: string, width: number) => `${url}?w=${width}&fit=max&auto=format&q=72`;
