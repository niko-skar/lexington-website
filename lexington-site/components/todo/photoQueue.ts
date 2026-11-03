"use client";

import { forgetPhoto, PhotoError, sendPhoto, shrinkFor, type PhotoEndpoint } from "./photo";

// Photos on their way (Niko, 3 Nov 2026: "it should load fast in my phone and upload in the background"). A photo
// starts uploading the moment it's taken, under a ticket the server knows it by. A form can be saved before it has
// landed: it sends "pending:<ticket>", and the server puts the photo on the record when it lands. A photo saved that
// way keeps trying until it's in (no signal on site), and waits on the phone (IndexedDB) so it still goes if the
// app is closed and opened again.

type Stored = { id: string; url: string };
export type UploadState = "uploading" | "ready" | "failed";

interface Job {
  ticket: string;
  endpoint: PhotoEndpoint;
  state: UploadState;
  result: Stored | null;
  error: string | null;
  /** Refused for good (not a photo, too big): trying again won't help. */
  final: boolean;
  /** Saved with a record: it must get there. */
  kept: boolean;
  /** Taken off before anything was saved with it: tidied away when it lands. */
  dropped: boolean;
  blob: Promise<Blob>;
}

const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const fn of listeners) fn();
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Waits between tries while there's no signal: soon at first, then every minute or two.
const WAITS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000];

export const newTicket = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Something to call whenever a photo's state changes (an upload landed, failed or was saved with a record). */
export function onUploads(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function uploadOf(ticket: string): Readonly<Job> | null {
  return jobs.get(ticket) ?? null;
}

/** How many photos saved with a record are still on their way (the app shows it). */
export function waitingUploads(): number {
  let n = 0;
  for (const job of jobs.values()) if (job.kept && job.state !== "ready" && !job.final) n++;
  return n;
}

/** A photo just taken: shrunk and on its way at once. */
export function startUpload(file: File, endpoint: PhotoEndpoint): string {
  const ticket = newTicket();
  const job: Job = { ticket, endpoint, state: "uploading", result: null, error: null, final: false, kept: false, dropped: false, blob: shrinkFor(file, endpoint) };
  jobs.set(ticket, job);
  void run(job);
  return ticket;
}

async function run(job: Job): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    if (job.dropped && !job.kept) {
      jobs.delete(job.ticket);
      return;
    }
    try {
      const stored = await sendPhoto(await job.blob, job.endpoint, job.ticket);
      job.result = stored;
      job.state = "ready";
      job.error = null;
      if (job.dropped && !job.kept) {
        forgetPhoto(stored.id, job.endpoint);
        jobs.delete(job.ticket);
      }
      if (job.kept) void unsave(job.ticket);
      changed();
      return;
    } catch (error) {
      const status = error instanceof PhotoError ? error.status : 0;
      job.error = error instanceof Error ? error.message : "The photo didn't upload.";
      // Signed out, or a refusal that won't change by trying again (408 and 429 are worth another go).
      if (status === 401 || status === 403 || (status >= 400 && status < 500 && status !== 408 && status !== 429)) {
        job.state = "failed";
        job.final = status !== 401 && status !== 403;
        if (job.kept && job.final) void unsave(job.ticket);
        changed();
        return;
      }
      job.state = job.kept ? "uploading" : "failed";
      changed();
      await sleep(WAITS[Math.min(attempt, WAITS.length - 1)]);
      job.state = "uploading";
      changed();
    }
  }
}

/** Saved with a record ("pending:<ticket>"): it has to get there, even if the app is closed meanwhile. */
export function keepUpload(ticket: string): void {
  const job = jobs.get(ticket);
  if (!job) return;
  job.kept = true;
  job.dropped = false;
  if (job.state !== "ready") void save(job);
  changed();
}

/** Taken off (retaken, removed, or the form cancelled): tidied away, now or when it lands. */
export function dropUpload(ticket: string): void {
  const job = jobs.get(ticket);
  if (!job || job.kept) return;
  job.dropped = true;
  if (job.state === "ready" && job.result) {
    forgetPhoto(job.result.id, job.endpoint);
    jobs.delete(ticket);
  }
}

/* ---------- kept on the phone until they're in ---------- */

const DB = "lexington-photos";
const STORE = "uploads";
const KEEP_DAYS = 7;
type Saved = { ticket: string; endpoint: PhotoEndpoint; bytes: ArrayBuffer; type: string; at: number };

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "ticket" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(conn.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    conn.close();
  }
}

async function save(job: Job): Promise<void> {
  try {
    const blob = await job.blob;
    const saved: Saved = { ticket: job.ticket, endpoint: job.endpoint, bytes: await blob.arrayBuffer(), type: blob.type || "image/jpeg", at: Date.now() };
    // Landed while it was being put away: nothing to keep.
    if (job.state === "ready") return;
    await withStore("readwrite", (store) => store.put(saved));
  } catch {
    // No room on the phone (or a private window): it still goes while the app is open.
  }
}

async function unsave(ticket: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(ticket));
  } catch {
    // Nothing kept.
  }
}

let resumed = false;

/** The app opened: photos saved with a record last time that never landed go now. */
export async function resumeUploads(): Promise<void> {
  if (resumed || typeof indexedDB === "undefined") return;
  resumed = true;
  try {
    const saved = await withStore<Saved[]>("readonly", (store) => store.getAll() as IDBRequest<Saved[]>);
    for (const s of saved) {
      if (jobs.has(s.ticket)) continue;
      if (Date.now() - s.at > KEEP_DAYS * 86_400_000) {
        void unsave(s.ticket);
        continue;
      }
      const job: Job = {
        ticket: s.ticket,
        endpoint: s.endpoint,
        state: "uploading",
        result: null,
        error: null,
        final: false,
        kept: true,
        dropped: false,
        blob: Promise.resolve(new Blob([s.bytes], { type: s.type })),
      };
      jobs.set(s.ticket, job);
      void run(job);
    }
    if (saved.length) changed();
  } catch {
    // Nothing kept, or no storage here.
  }
}
