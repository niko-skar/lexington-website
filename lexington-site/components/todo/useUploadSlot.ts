"use client";

import { useCallback, useRef, useState } from "react";

import { errorText } from "./api";
import { forgetPhoto, uploadPhoto, type PhotoEndpoint } from "./photo";

// One photo being added in a sheet: it starts uploading the moment it's taken, shows itself while
// it goes, and is tidied away if it's replaced or the sheet is cancelled.

export type Slot = { preview: string; state: "uploading" | "ready" | "error"; id?: string; url?: string; error?: string };

export function useUploadSlot(endpoint: PhotoEndpoint = "/api/todo/photo") {
  const [slot, setSlot] = useState<Slot | null>(null);
  const job = useRef<Promise<{ id: string; url: string } | null> | null>(null);
  const token = useRef(0);

  const start = useCallback(
    (file: File) => {
      const mine = ++token.current;
      const preview = URL.createObjectURL(file);
      setSlot((old) => {
        if (old?.preview) URL.revokeObjectURL(old.preview);
        if (old?.id) forgetPhoto(old.id, endpoint);
        return { preview, state: "uploading" };
      });
      job.current = uploadPhoto(file, endpoint).then(
        (stored) => {
          if (token.current !== mine) {
            forgetPhoto(stored.id, endpoint); // replaced by a newer photo meanwhile
            return null;
          }
          setSlot({ preview, state: "ready", id: stored.id, url: stored.url });
          return stored;
        },
        (e) => {
          if (token.current === mine) setSlot({ preview, state: "error", error: errorText(e) });
          return null;
        }
      );
    },
    [endpoint]
  );

  const clear = useCallback(
    (keepStored = false) => {
      token.current++;
      job.current = null;
      setSlot((old) => {
        if (old?.preview) URL.revokeObjectURL(old.preview);
        if (old?.id && !keepStored) forgetPhoto(old.id, endpoint);
        return null;
      });
    },
    [endpoint]
  );

  /** Waits for an upload still on its way; null when there's no photo or it failed. */
  const settled = useCallback(async () => (job.current ? job.current : null), []);

  return { slot, start, clear, settled };
}
