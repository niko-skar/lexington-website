"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isPdf, type PhotoEndpoint } from "./photo";
import { dropUpload, keepUpload, onUploads, startUpload, uploadOf } from "./photoQueue";

// One photo being added in a sheet: it starts uploading the moment it's taken and shows itself at once. The sheet can
// be saved while it's still on its way (3 Nov 2026, photoQueue.ts): it goes on uploading, and onto the record, by
// itself. A replaced photo, or a cancelled sheet's, is tidied away.

/**
 * final: refused for good (not a photo, too big): take it again. Otherwise an error is no signal yet, and it goes on
 * trying. pdf: a PDF (a bill's), shown by its name.
 */
export type Slot = { preview: string; pdf: boolean; name: string; state: "uploading" | "ready" | "error"; id?: string; url?: string; error?: string; final?: boolean; ticket: string };

/** The line under a photo in a sheet. */
export const slotWords = (s: Pick<Slot, "state" | "error" | "final"> & { pdf?: boolean }) =>
  s.state === "ready"
    ? s.pdf
      ? "PDF ready"
      : "Photo ready"
    : s.state === "uploading"
      ? "Uploading… you can save now: it carries on by itself"
      : s.final
        ? (s.error ?? (s.pdf ? "That PDF can't be used: pick another." : "That photo can't be used: take it again."))
        : "No signal yet: it uploads by itself when there is. You can save now.";

export function useUploadSlot(endpoint: PhotoEndpoint = "/api/todo/photo") {
  const [slot, setSlot] = useState<Slot | null>(null);
  const current = useRef<Slot | null>(null);

  const show = useCallback((next: Slot | null) => {
    current.current = next;
    setSlot(next);
  }, []);

  // The upload's progress, as it goes.
  useEffect(
    () =>
      onUploads(() => {
        const s = current.current;
        const job = s ? uploadOf(s.ticket) : null;
        if (!s || !job) return;
        const state = job.state === "ready" ? "ready" : job.state === "failed" ? "error" : "uploading";
        if (state !== s.state || job.result?.id !== s.id || job.final !== !!s.final) {
          show({ ...s, state, id: job.result?.id, url: job.result?.url, error: job.error ?? undefined, final: job.final });
        }
      }),
    [show]
  );

  const start = useCallback(
    (file: File) => {
      const old = current.current;
      if (old) {
        URL.revokeObjectURL(old.preview);
        dropUpload(old.ticket);
      }
      show({ preview: URL.createObjectURL(file), pdf: isPdf(file), name: file.name, state: "uploading", ticket: startUpload(file, endpoint) });
    },
    [endpoint, show]
  );

  /** Empties the slot. keepStored: it was just saved with something, so it goes on (and onto that) by itself. */
  const clear = useCallback(
    (keepStored = false) => {
      const old = current.current;
      if (!old) return;
      // A photo saved before it landed may still be on screen from the phone's own copy until it does.
      if (keepStored) keepUpload(old.ticket);
      else {
        dropUpload(old.ticket);
        URL.revokeObjectURL(old.preview);
      }
      show(null);
    },
    [show]
  );

  /**
   * The photo to save with: its id once it's in, else "pending:<ticket>" (the server puts it on the record when it
   * lands). Null with no photo, or one refused for good (not a photo, too big): take it again.
   */
  const settled = useCallback(async (): Promise<{ id: string; url: string } | null> => {
    const s = current.current;
    if (!s) return null;
    const job = uploadOf(s.ticket);
    if (job?.result) return job.result;
    if (!job || job.final) return null;
    return { id: `pending:${s.ticket}`, url: s.preview };
  }, []);

  /** Waits until the photo is in (for a photo that is the whole point, like an item's new picture). */
  const landed = useCallback(
    () =>
      new Promise<{ id: string; url: string } | null>((resolve) => {
        const s = current.current;
        if (!s) return resolve(null);
        const check = (): boolean => {
          const job = uploadOf(s.ticket);
          if (job?.result) {
            resolve(job.result);
            return true;
          }
          if (!job || job.final || job.state === "failed") {
            resolve(null);
            return true;
          }
          return false;
        };
        if (check()) return;
        const stop = onUploads(() => {
          if (check()) stop();
        });
      }),
    []
  );

  return { slot, start, clear, settled, landed };
}
