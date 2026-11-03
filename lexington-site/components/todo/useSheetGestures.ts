"use client";

import { useEffect } from "react";

import styles from "./Todo.module.css";

// Closing a sheet the way a phone expects (Niko, 3 Nov 2026: "Let me swipe down on menus to close them or tap out of
// them"): a tap on the shade around it, a pull down from its top, or Esc on a laptop. Each does what the sheet's own
// Cancel or Close button does (so a photo half-taken is tidied away the same way); a sheet busy saving stays.

/** The button that closes a sheet: its Cancel, Close or Done (the last one there, as it sits at the bottom). */
export function closeButtonOf(dialog: HTMLElement): HTMLButtonElement | null {
  const close = [...dialog.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => b.getClientRects().length > 0 && (b.classList.contains(styles.sheetCancel) || /^(close|cancel|done)$/i.test(b.textContent?.trim() ?? ""))
  );
  return close[close.length - 1] ?? null;
}

const shadeOf = (target: EventTarget | null) => (target instanceof HTMLElement && target.classList.contains(styles.sheetBackdrop) ? target : null);
const dialogIn = (shade: HTMLElement) => shade.querySelector<HTMLElement>(':scope > [role="dialog"]');

/** Pulled this far down (or flicked), a sheet closes. */
const CLOSE_AT = 110;

export function useSheetGestures(): void {
  useEffect(() => {
    // Esc: the window on top.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const open = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter((d) => d.getClientRects().length > 0);
      const top = open[open.length - 1];
      const button = top ? closeButtonOf(top) : null;
      if (!button || button.disabled) return;
      e.preventDefault();
      button.click();
    };

    // A tap on the shade: one that started there too (not a drag out of the sheet that ended on it).
    let pressed: HTMLElement | null = null;
    const onPointerDown = (e: PointerEvent) => {
      pressed = shadeOf(e.target);
    };
    const onClick = (e: MouseEvent) => {
      const shade = shadeOf(e.target);
      if (!shade || shade !== pressed) return;
      pressed = null;
      const dialog = dialogIn(shade);
      if (!dialog) return;
      // The sheet's own close button does it (some shades close on a tap by themselves: only once).
      e.preventDefault();
      e.stopPropagation();
      const button = closeButtonOf(dialog);
      if (button && !button.disabled) button.click();
    };

    // A pull down from the top of the sheet: it follows the finger, and closes past CLOSE_AT (or on a flick).
    let drag: { sheet: HTMLElement; x0: number; y0: number; t0: number; dy: number; on: boolean; off: boolean } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      drag = null;
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      const sheet = target?.closest<HTMLElement>(`.${styles.sheet}`);
      if (!sheet || !shadeOf(sheet.parentElement) || target?.closest("input, textarea, select, [contenteditable]")) return;
      const t = e.touches[0];
      drag = { sheet, x0: t.clientX, y0: t.clientY, t0: performance.now(), dy: 0, on: false, off: false };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!drag || drag.off) return;
      const t = e.touches[0];
      const dx = t.clientX - drag.x0;
      const dy = t.clientY - drag.y0;
      if (!drag.on) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // Only straight down, with the sheet at its top: anything else scrolls as usual.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || drag.sheet.scrollTop > 0) {
          drag.off = true;
          return;
        }
        drag.on = true;
        drag.sheet.style.transition = "none";
      }
      e.preventDefault();
      drag.dy = Math.max(0, dy);
      drag.sheet.style.transform = `translateY(${drag.dy}px)`;
    };
    const onTouchEnd = () => {
      const d = drag;
      drag = null;
      if (!d?.on) return;
      const flick = d.dy > 40 && d.dy / Math.max(1, performance.now() - d.t0) > 0.6;
      const button = d.sheet.matches('[role="dialog"]') ? closeButtonOf(d.sheet) : null;
      d.sheet.style.transition = "transform 0.18s ease-out";
      if ((d.dy > CLOSE_AT || flick) && button && !button.disabled) {
        d.sheet.style.transform = "translateY(100%)";
        setTimeout(() => {
          button.click();
          // Still there (it didn't close after all): back up.
          d.sheet.style.transform = "";
        }, 170);
      } else d.sheet.style.transform = "";
      setTimeout(() => {
        d.sheet.style.transition = "";
      }, 400);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("click", onClick, true);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("click", onClick, true);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);
}
