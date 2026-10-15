"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// A small per-device setting kept in this browser (tolerances, pull-back). Read
// through useSyncExternalStore so the server render and the first client render
// agree, and every part of the page sees a change at once.

const EVENT = "asbuilt-setting";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useLocalSetting<T>(key: string, fallback: T): [T, (value: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = useMemo(() => {
    if (raw === null) return fallback;
    try {
      return { ...fallback, ...JSON.parse(raw) } as T;
    } catch {
      return fallback;
    }
    // `fallback` is a constant from the caller; only the stored text matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
  const set = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private mode or storage blocked: the setting just won't stick.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}
