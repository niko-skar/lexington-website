// The site to-do list (/todo): what an item looks like, shared by the server and the phone page.
// Niko (22 Oct 2026): "a to do list for the construction where I can take a picture of something
// on the site and leave a comment, then share only that page with my foreman who can tick off
// when things are done" -- an app on his iPhone and the foreman's Android, both live at once.

/** Floors as the as-built record names them (ground to 7th, then the roof), plus the yard. */
export const AREAS = ["Ground", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "Roof", "Outside"] as const;
export type Area = (typeof AREAS)[number];

export const areaLabel = (area: string | null | undefined) =>
  !area ? "No floor given" : area === "Ground" ? "Ground floor" : area === "Roof" || area === "Outside" ? area : `${area} floor`;

export const MAX_TEXT = 600;
export const MAX_NOTE = 300;

export interface TodoTask {
  id: string;
  text: string;
  area: string | null;
  urgent: boolean;
  status: "open" | "done";
  createdAt: string;
  createdBy: string;
  photoUrl: string | null;
  doneAt: string | null;
  doneBy: string | null;
  doneNote: string | null;
  /** A photo of the finished work, taken when (or after) it was ticked. */
  fixUrl: string | null;
  updatedAt: string;
}

/** Who is using the page: Niko and other admins add and delete; a "site" login (the foreman) ticks. */
export interface TodoMe {
  kind: "admin" | "site";
  name: string;
}

export interface SiteAccount {
  id: string;
  name: string;
  email: string;
}

/** A smaller copy of a stored photo from Sanity's image CDN (it resizes on the fly). */
export const photoAt = (url: string, width: number) => `${url}?w=${width}&fit=max&auto=format&q=72`;
