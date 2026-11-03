// What a pour carries besides its checklist (Niko, 3 Nov 2026):
//  - its pre-pour photos: "a place to add the pre pour photos that capture all the steel, these have to be full
//    resolution photos for future analysis. will also show pipe routing and such ... i have 1000 photos on my phone
//    that i have to scroll incessantly to find pre pour photos and i want it to be better organised." The originals go
//    to the photo store (Vercel Blob, private) at full size; a smaller copy shows them in the app.
//  - its concrete cubes: "concrete cubes ready to be taken, then reminders to get them tested at 7 days and 14 days and
//    a place to put in the results (And attach the results form) it should be able to read the results form and fill
//    in the information for me, most important being the compressive strength in mPa or what i'm aiming for is c35".
//    A 28-day test too: that's the age C35 is judged at.
// Shared by the server and the phone.

import { ghanaDay } from "@/lib/store/shared";

export const PHOTO_KINDS = ["steel", "pipes", "other"] as const;
export type PourPhotoKind = (typeof PHOTO_KINDS)[number];
export const PHOTO_KIND_NAMES: Record<PourPhotoKind, string> = { steel: "Steel", pipes: "Pipes & sleeves", other: "Other" };
export const isPhotoKind = (v: unknown): v is PourPhotoKind => typeof v === "string" && (PHOTO_KINDS as readonly string[]).includes(v);

/** One pre-pour photo: a copy to look at in the app, and the original at full size. */
export interface PourPhoto {
  id: string;
  pourId: string;
  kind: PourPhotoKind;
  /** The copy shown in the app (the image store's, resized on the fly). */
  previewUrl: string | null;
  /** The original's size on the phone. */
  width: number | null;
  height: number | null;
  bytes: number | null;
  /** When the photo was taken (the camera's own time), else when it was added. */
  takenAt: string;
  at: string;
  by: string;
}

/** The ages the cubes are crushed at, in days. */
export const CUBE_AGES = [7, 14, 28] as const;
/** What the concrete is aiming for (MPa): C35. Changeable on the pour (a C35/45 mix's cubes aim for 45). */
export const DEFAULT_TARGET_MPA = 35;

export interface CubeTest {
  age: number;
  /** YYYY-MM-DD: the pour's day plus its age. */
  due: string;
  testedOn: string | null;
  /** Each cube's compressive strength in MPa. */
  strengths: number[];
  /** The average of the strengths (or the form's own), MPa. */
  average: number | null;
  /** The lab's results form, when attached. */
  form: { url: string; type: string; id: string } | null;
  /** Reading the form: "working", "done", "failed" (and why), or null before any. */
  reading: "working" | "done" | "failed" | null;
  readNote: string | null;
  at: string | null;
  by: string | null;
}

export interface PourCubes {
  pourId: string;
  /** Cubes taken at the pour, or null before they are. */
  taken: number | null;
  takenAt: string | null;
  target: number;
  tests: CubeTest[];
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** "Today", "Tomorrow", "Yesterday", else "Tue 4 Nov". */
export const dayWords = (day: string) => {
  const today = ghanaDay();
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};
export const average = (xs: readonly number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** A test's strength against the target, as a share (32 of 35 is 91%). */
export const shareOf = (mpa: number | null, target: number) => (mpa === null || !target ? null : Math.round((mpa / target) * 100));

/** A test is due (or late) without its result. */
export const isDue = (t: CubeTest, today: string) => t.average === null && t.due <= today;

/** Early tests: what a good mix usually reaches by then, as a share of its 28-day strength (a rule of thumb, not a pass or fail). */
export const USUAL_SHARE: Record<number, number> = { 7: 65, 14: 85, 28: 100 };
