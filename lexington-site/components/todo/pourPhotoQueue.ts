import { upload } from "@vercel/blob/client";

import type { PourPhotoKind } from "@/lib/concrete/pourExtras";
import type { ConcreteData } from "@/lib/concrete/shared";
import { send } from "./api";
import { forgetPhoto, PhotoError, sendPhoto, shrinkSized } from "./photo";
import { photoTakenAt } from "./photoTime";

// Pre-pour photos on their way (lib/concrete/pourExtras.ts says what and why). Each one: a copy to look at goes to the
// image store, the original at full size straight to the private photo store (no website upload limit there), then the
// pour gets it. One at a time, kept here rather than in a card, so they carry on while the page changes (a pour poured
// meanwhile moves to another list); a failed one waits for "Try again", or for the signal to come back.

export interface PourUpload {
  key: number;
  pourId: string;
  kind: PourPhotoKind;
  file: File;
  /** The small copy's own preview on the phone, once made (the original is too big to show many of). */
  preview: string | null;
  state: "waiting" | "sending" | "error";
  /** How far the original is, 0 to 100. */
  percent: number;
  error?: string;
  /** No signal: tried again by itself when the phone is back online. */
  retry?: boolean;
  takenAt?: string | null;
  previewId?: string;
  size?: { width: number; height: number };
  original?: { url: string; pathname: string };
}

let jobs: PourUpload[] = [];
let counter = 0;
let running = false;
let sink: ((data: ConcreteData) => void) | null = null;
const listeners = new Set<() => void>();

const changed = () => listeners.forEach((fn) => fn());
const update = (key: number, change: Partial<PourUpload>) => {
  jobs = jobs.map((j) => (j.key === key ? { ...j, ...change } : j));
  changed();
};
const jobOf = (key: number) => jobs.find((j) => j.key === key);

export const pourUploads = () => jobs;
export function onPourUploads(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** Where a photo's pour goes once it's in: the concrete page's data as the website has it then. */
export function setPourDataSink(fn: ((data: ConcreteData) => void) | null) {
  sink = fn;
}

/** Photos picked for a pour: each goes in turn. */
export function addPourPhotos(pourId: string, kind: PourPhotoKind, files: File[]) {
  if (!files.length) return;
  jobs = [...jobs, ...files.map((file) => ({ key: ++counter, pourId, kind, file, preview: null, state: "waiting" as const, percent: 0 }))];
  changed();
  watchLeaving();
  void run();
}

export function retryPourUpload(key: number) {
  if (jobOf(key)?.state !== "error") return;
  update(key, { state: "waiting", error: undefined, retry: false });
  void run();
}

/** Taken off before it was in: its copy is tidied away (an original already up stays unseen in the photo store). */
export function dropPourUpload(key: number) {
  const job = jobOf(key);
  if (!job || job.state === "sending") return;
  if (job.preview) URL.revokeObjectURL(job.preview);
  if (job.previewId) forgetPhoto(job.previewId, "/api/concrete/photo");
  jobs = jobs.filter((j) => j.key !== key);
  changed();
}

async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = jobs.find((j) => j.state === "waiting");
      if (!job) break;
      update(job.key, { state: "sending" });
      try {
        await sendOne(job.key);
        const done = jobOf(job.key);
        if (done?.preview) URL.revokeObjectURL(done.preview);
        jobs = jobs.filter((j) => j.key !== job.key);
        changed();
      } catch (e) {
        const offline = (e instanceof PhotoError && e.status === 0) || (e as { status?: number })?.status === 0 || e instanceof TypeError;
        update(job.key, { state: "error", error: e instanceof Error ? e.message : "The photo didn't upload. Try again.", retry: offline });
      }
    }
  } finally {
    running = false;
  }
}

const extOf = (file: File) => {
  const type = typeOf(file);
  return type === "image/png" ? "png" : type === "image/heic" ? "heic" : type === "image/heif" ? "heif" : type === "image/webp" ? "webp" : "jpg";
};
function typeOf(file: File): string {
  if (file.type) return file.type === "image/jpg" ? "image/jpeg" : file.type;
  const name = file.name.toLowerCase();
  return name.endsWith(".png") ? "image/png" : name.endsWith(".heic") ? "image/heic" : name.endsWith(".heif") ? "image/heif" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
}
const stamp = (iso: string | null | undefined) => (iso ?? new Date().toISOString()).replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/** One photo, carried on from where it stopped (a copy already in isn't sent twice). */
async function sendOne(key: number) {
  let job = jobOf(key)!;
  if (job.takenAt === undefined) {
    const exif = await photoTakenAt(job.file).catch(() => null);
    update(key, { takenAt: exif ? exif.toISOString() : job.file.lastModified ? new Date(job.file.lastModified).toISOString() : null });
    job = jobOf(key)!;
  }
  if (!job.previewId) {
    let made: { blob: Blob; width: number; height: number };
    try {
      made = await shrinkSized(job.file, 1280, 0.74);
    } catch {
      throw new PhotoError("This phone can't open that photo: take it again as a normal photo.", 415);
    }
    if (!job.preview) update(key, { preview: URL.createObjectURL(made.blob) });
    const { id } = await sendPhoto(made.blob, "/api/concrete/photo");
    update(key, { previewId: id, size: { width: made.width, height: made.height } });
    job = jobOf(key)!;
  }
  if (!job.original) {
    try {
      const put = await upload(`pours/${job.pourId}/${job.kind}-${stamp(job.takenAt)}.${extOf(job.file)}`, job.file, {
        access: "private",
        handleUploadUrl: "/api/concrete/pour-photo/blob",
        contentType: typeOf(job.file),
        multipart: job.file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => {
          const now = jobOf(key);
          if (now && Math.round(percentage) !== now.percent) update(key, { percent: Math.round(percentage) });
        },
      });
      update(key, { original: { url: put.url, pathname: put.pathname }, percent: 100 });
    } catch (e) {
      const text = e instanceof Error ? e.message : "";
      if (/content type/i.test(text)) throw new PhotoError("That file isn't a photo the app can keep (JPEG, HEIC or PNG).", 415);
      if (/too large|exceeds|maximum/i.test(text)) throw new PhotoError("That photo is over 80 MB.", 413);
      if (!navigator.onLine || /network|fetch|failed to fetch|load failed|aborted|timed out/i.test(text)) throw new PhotoError("No signal: the full-size photo didn't upload yet.", 0);
      throw new PhotoError("The full-size photo didn't upload. Try again.", 500);
    }
    job = jobOf(key)!;
  }
  const data = await send<ConcreteData>("/api/concrete/pours", "POST", {
    action: "photo",
    pourId: job.pourId,
    kind: job.kind,
    previewId: job.previewId,
    original: { ...job.original, bytes: job.file.size, width: job.size?.width, height: job.size?.height },
    takenAt: job.takenAt,
  });
  sink?.(data);
}

// While photos are still going: the signal coming back sends the ones that stopped for it, and closing the page asks
// first (an original only goes from this page).
let watching = false;
function watchLeaving() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("online", () => {
    let any = false;
    jobs = jobs.map((j) => {
      if (j.state !== "error" || !j.retry) return j;
      any = true;
      return { ...j, state: "waiting", error: undefined, retry: false };
    });
    if (!any) return;
    changed();
    void run();
  });
  window.addEventListener("beforeunload", (e) => {
    if (!jobs.length) return;
    e.preventDefault();
    e.returnValue = "";
  });
}
