"use client";

import { useRef, useState } from "react";

import { internationalDigits } from "@/lib/format";
import styles from "./Crm.module.css";

// Copies a prospect's number, to paste into WhatsApp's search and find the conversation (Niko, 13 Nov 2026: "a copy
// number button for the crm so i can easily copy the number and look up our conversation"). Copied in the full
// international form with no spaces (+233267012347): the form WhatsApp's search finds however the number was typed
// into the CRM (026 701 2347, +233 26 701 2347).
export function copyForm(phone: string): string {
  const digits = internationalDigits(phone);
  return digits ? `+${digits}` : phone.trim();
}

export function CopyNumber({ phone }: { phone: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const text = copyForm(phone);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // An older browser, or one that keeps the clipboard to itself: the long way round.
      try {
        const box = document.createElement("textarea");
        box.value = text;
        box.setAttribute("readonly", "");
        box.style.position = "fixed";
        box.style.opacity = "0";
        document.body.appendChild(box);
        box.select();
        ok = document.execCommand("copy");
        box.remove();
      } catch {
        ok = false;
      }
    }
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" className={styles.btn} onClick={() => void copy()} title={`Copy ${text}`} aria-live="polite">
      {state === "copied" ? "Copied ✓" : state === "failed" ? "Couldn't copy" : "Copy number"}
    </button>
  );
}
