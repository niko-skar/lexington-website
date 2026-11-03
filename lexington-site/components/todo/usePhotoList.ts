"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PhotoEndpoint } from "./photo";
import { dropUpload, keepUpload, onUploads, startUpload, uploadOf } from "./photoQueue";

// Several photos in one sheet (opening or closing the store room): each starts uploading the moment it's taken, and
// the sheet can be saved while they're still on their way (3 Nov 2026, photoQueue.ts). One taken off, or a cancelled
// sheet's, is tidied away.

/** final: refused for good (take it off and again); otherwise an error is no signal yet, and it goes on trying. */
export type ListPhoto = { key: number; preview: string; state: "uploading" | "ready" | "error"; error?: string; final?: boolean; ticket: string };

export function usePhotoList(endpoint: PhotoEndpoint) {
  const [photos, setPhotos] = useState<ListPhoto[]>([]);
  const list = useRef<ListPhoto[]>([]);
  const next = useRef(0);

  const show = useCallback((nextList: ListPhoto[]) => {
    list.current = nextList;
    setPhotos(nextList);
  }, []);

  useEffect(
    () =>
      onUploads(() => {
        let moved = false;
        const nextList = list.current.map((p) => {
          const job = uploadOf(p.ticket);
          const state: ListPhoto["state"] = job?.state === "ready" ? "ready" : job?.state === "failed" ? "error" : "uploading";
          if (state === p.state && !!job?.final === !!p.final) return p;
          moved = true;
          return { ...p, state, error: job?.error ?? undefined, final: !!job?.final };
        });
        if (moved) show(nextList);
      }),
    [show]
  );

  const add = useCallback(
    (file: File) => {
      const key = ++next.current;
      show([...list.current, { key, preview: URL.createObjectURL(file), state: "uploading", ticket: startUpload(file, endpoint) }]);
    },
    [endpoint, show]
  );

  const remove = useCallback(
    (key: number) => {
      const gone = list.current.find((p) => p.key === key);
      if (!gone) return;
      dropUpload(gone.ticket);
      URL.revokeObjectURL(gone.preview);
      show(list.current.filter((p) => p.key !== key));
    },
    [show]
  );

  /** Empties the sheet; the photos go on (and onto the record) only when they were just saved with something. */
  const clear = useCallback(
    (keepStored = false) => {
      for (const p of list.current) {
        if (keepStored) keepUpload(p.ticket);
        else dropUpload(p.ticket);
        URL.revokeObjectURL(p.preview);
      }
      show([]);
    },
    [show]
  );

  /** The photos to save with: ids for those in, "pending:<ticket>" for those on their way; null if one was refused for good. */
  const settled = useCallback(async () => {
    const ids: string[] = [];
    for (const p of list.current) {
      const job = uploadOf(p.ticket);
      if (job?.result) ids.push(job.result.id);
      else if (!job || job.final) return null;
      else ids.push(`pending:${p.ticket}`);
    }
    return ids;
  }, []);

  return { photos, add, remove, clear, settled };
}
