"use client";

import { useSyncExternalStore } from "react";

import { pushEvent } from "@/lib/analytics";
import type { AreaUnit } from "@/lib/area";

// Square metres or square feet: the visitor's choice, shared by every size on the page and kept in their browser for the
// next visit. Visitors in the Americas, where homes are sized in square feet, start in square feet; everyone else in square
// metres. The page itself is rendered in square metres and switches once it is in the browser.

const KEY = "lexington-area-unit";
const CHANGED = "lexington-area-unit";

let chosen: AreaUnit | null = null; // (this visit's choice, for when the browser won't store it)

function current(): AreaUnit {
  if (chosen) return chosen;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "sqm" || saved === "sqft") return saved;
  } catch {
    // storage blocked: fall through to the default
  }
  try {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone.startsWith("America/")) return "sqft";
  } catch {
    // no time zone: square metres
  }
  return "sqm";
}

function subscribe(notify: () => void) {
  window.addEventListener(CHANGED, notify);
  window.addEventListener("storage", notify); // (another tab changed it)
  return () => {
    window.removeEventListener(CHANGED, notify);
    window.removeEventListener("storage", notify);
  };
}

export function setAreaUnit(unit: AreaUnit) {
  chosen = unit;
  try {
    window.localStorage.setItem(KEY, unit);
  } catch {
    // not stored: it still holds for this visit
  }
  window.dispatchEvent(new Event(CHANGED));
  pushEvent({ event: "area_unit", unit });
}

export function useAreaUnit(): AreaUnit {
  return useSyncExternalStore(subscribe, current, () => "sqm");
}
