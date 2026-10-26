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
 * The parts of the site app (one home-screen app, a tab bar at the bottom). The office opens all
 * of them; a site login opens what the office ticked for it, and never the expenses (money) or the
 * alerts (Niko's enquiries, leads and messages; 23 Oct 2026, instead of emails).
 */
export const SECTIONS = ["todo", "store", "expenses", "alerts"] as const;
export type Section = (typeof SECTIONS)[number];
export type SiteSection = Exclude<Section, "expenses" | "alerts">;
export const SITE_SECTIONS: readonly SiteSection[] = ["todo", "store"];
export const sectionHref = (section: Section) => (section === "todo" ? "/todo" : `/todo/${section}`);
const SECTION_NAMES: Record<Section, string> = { todo: "To-do", store: "Store", expenses: "Expenses", alerts: "Alerts" };
export const sectionName = (section: Section) => SECTION_NAMES[section];
/** Where a sign-in from the app may send someone back to. */
export const APP_PAGES: readonly string[] = SECTIONS.map(sectionHref);

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
