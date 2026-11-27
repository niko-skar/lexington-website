"use client";

import { useEffect } from "react";

// The app's copy on this phone (27 Nov 2026, Niko: "Is it possible that it can open the last saved version thats stored
// on the phone offline so i can use it immediately while it restores the connection?"). The helper (public/todo-sw.js)
// keeps each page as it last came, each part's last figures and the app's code; this is the app's side of it.

const PAGES = "todo-pages-v2";
const DATA = "todo-data-v2";

/**
 * When the page on screen was saved on this phone (the helper stamps a page it opens from its copy), or null when it
 * came straight from the website. Read once, before the page starts, so the part on screen knows to ask for its figures
 * at once instead of trusting the ones the page came with.
 */
export const SAVED_AT: string | null =
  typeof document === "undefined" ? null : (document.querySelector('meta[name="todo-saved-at"]')?.getAttribute("content") ?? null);

/** A part's figures as this phone last had them (null: none kept, or no room for copies on this phone). */
export async function savedFigures<T>(path: string): Promise<T | null> {
  try {
    if (typeof caches === "undefined") return null;
    const hit = await caches.match(path, { cacheName: DATA, ignoreVary: true });
    return hit ? ((await hit.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Signing out (or the sign-in page showing): the pages and figures kept on this phone go, and so does the roll call's
 * copy. The roll call's marks that haven't been sent yet stay, under their own login, for when it signs in again.
 */
export function forgetPhoneCopy() {
  try {
    if (typeof caches !== "undefined") {
      void caches.delete(PAGES).catch(() => {});
      void caches.delete(DATA).catch(() => {});
    }
  } catch {
    /* nothing kept */
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("rollcall-v1:")) localStorage.removeItem(key);
    }
  } catch {
    /* private mode */
  }
}

/** The app's code the page loaded before the helper was in charge of it (the first time after it's put on): kept now. */
export function keepLoadedFiles() {
  try {
    const helper = navigator.serviceWorker?.controller;
    if (!helper) return;
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => u.startsWith(`${window.location.origin}/_next/static/`) || u.startsWith(`${window.location.origin}/todo/rollcall`));
    helper.postMessage({ type: "todo-keep", urls });
  } catch {
    /* no helper here (a private window, an old phone) */
  }
}

/** Something on screen is being filled in or sent: the app doesn't reload under it. */
function busy(isBusy: () => boolean): boolean {
  if (isBusy()) return true;
  if (document.querySelector('[role="dialog"]')) return true;
  const typing = (el: Element | null) => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  const active = document.activeElement;
  if (typing(active)) return true;
  if (active instanceof HTMLIFrameElement) {
    try {
      const inner = active.contentDocument;
      if (typing(inner?.activeElement ?? null) || inner?.querySelector(".sheet, .modal, [role='dialog']")) return true;
    } catch {
      /* not ours */
    }
  }
  return false;
}

/**
 * What the helper says while the app is open: a newer version of the app is out (it reloads at a quiet moment: at once
 * if nobody has touched it yet, else when it's put away), or this phone has been signed out (to the sign-in at once).
 */
export function usePhoneCopyNews(isBusy: () => boolean) {
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const openedAt = Date.now();
    let touched = false;
    let newer = false;
    const reload = () => window.location.reload();
    const onTouch = () => {
      touched = true;
    };
    const tryNow = () => {
      if (!newer || busy(isBusy)) return;
      newer = false;
      reload();
    };
    const onMessage = (e: MessageEvent) => {
      const type = (e.data as { type?: string } | null)?.type;
      if (type === "todo-signed-out") {
        // Once a minute at most, so an odd answer can never keep reloading the app.
        try {
          const last = Number(sessionStorage.getItem("todo-signed-out-reload") || 0);
          if (Date.now() - last < 60_000) return;
          sessionStorage.setItem("todo-signed-out-reload", String(Date.now()));
        } catch {
          /* private mode */
        }
        reload();
      }
      if (type === "todo-update") {
        newer = true;
        if (!touched && Date.now() - openedAt < 12_000) tryNow();
      }
    };
    // Put away (another app, the phone locked) or brought back: a quiet moment for the newer version.
    const onVisibility = () => tryNow();
    sw.addEventListener("message", onMessage);
    window.addEventListener("pointerdown", onTouch, { passive: true });
    window.addEventListener("keydown", onTouch);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      sw.removeEventListener("message", onMessage);
      window.removeEventListener("pointerdown", onTouch);
      window.removeEventListener("keydown", onTouch);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isBusy]);
}
