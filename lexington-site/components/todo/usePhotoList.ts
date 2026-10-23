"use client";

import { useCallback, useRef, useState } from "react";

import { errorText } from "./api";
import { forgetPhoto, uploadPhoto, type PhotoEndpoint } from "./photo";

// Several photos in one sheet (opening or closing the store room): each starts uploading the
// moment it's taken; one taken off, or a cancelled sheet's, is tidied away.

export type ListPhoto = { key: number; preview: string; state: "uploading" | "ready" | "error"; error?: string };

export function usePhotoList(endpoint: PhotoEndpoint) {
  const [photos, setPhotos] = useState<ListPhoto[]>([]);
  const jobs = useRef(new Map<number, Promise<string | null>>());
  const stored = useRef(new Map<number, string>());
  const next = useRef(0);

  const add = useCallback(
    (file: File) => {
      const key = ++next.current;
      const preview = URL.createObjectURL(file);
      setPhotos((list) => [...list, { key, preview, state: "uploading" }]);
      jobs.current.set(
        key,
        uploadPhoto(file, endpoint).then(
          (photo) => {
            if (!jobs.current.has(key)) {
              forgetPhoto(photo.id, endpoint); // taken off while it uploaded
              return null;
            }
            stored.current.set(key, photo.id);
            setPhotos((list) => list.map((p) => (p.key === key ? { ...p, state: "ready" } : p)));
            return photo.id;
          },
          (e) => {
            setPhotos((list) => list.map((p) => (p.key === key ? { ...p, state: "error", error: errorText(e) } : p)));
            return null;
          }
        )
      );
    },
    [endpoint]
  );

  const remove = useCallback(
    (key: number) => {
      jobs.current.delete(key);
      const id = stored.current.get(key);
      if (id) forgetPhoto(id, endpoint);
      stored.current.delete(key);
      setPhotos((list) => {
        const gone = list.find((p) => p.key === key);
        if (gone) URL.revokeObjectURL(gone.preview);
        return list.filter((p) => p.key !== key);
      });
    },
    [endpoint]
  );

  /** Empties the sheet; the uploaded photos are kept only when they were just saved with something. */
  const clear = useCallback(
    (keepStored = false) => {
      if (!keepStored) for (const id of stored.current.values()) forgetPhoto(id, endpoint);
      stored.current.clear();
      jobs.current.clear();
      setPhotos((list) => {
        for (const p of list) URL.revokeObjectURL(p.preview);
        return [];
      });
    },
    [endpoint]
  );

  /** Waits for uploads still going: the photos' ids, or null if one of them failed. */
  const settled = useCallback(async () => {
    const ids = await Promise.all([...jobs.current.values()]);
    return ids.every((id): id is string => !!id) ? ids : null;
  }, []);

  return { photos, add, remove, clear, settled };
}
