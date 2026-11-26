"use client";

import { useActionState } from "react";

import { testWhatsAppAction, type WhatsAppTestState } from "@/lib/actions/whatsappTest";

import styles from "./Dashboard.module.css";

const idle: WhatsAppTestState = { status: "idle", message: "" };

/** Sends the first WhatsApp (the approved template) to one number, to see it arrive. */
export function TestWhatsAppButton() {
  const [state, action, pending] = useActionState(testWhatsAppAction, idle);
  return (
    <form action={action} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 10 }}>
      <input name="number" type="tel" required placeholder="Number, e.g. +233 24 123 4567" aria-label="Number to send the test to" className={styles.input} style={{ minWidth: 0, flex: "1 1 220px" }} />
      <input name="name" placeholder="Name to greet (optional)" aria-label="Name to greet" className={styles.input} style={{ minWidth: 0, flex: "1 1 160px" }} />
      <button type="submit" className={styles.btn} disabled={pending}>
        {pending ? "Sending…" : "Send a test"}
      </button>
      {state.status !== "idle" && (
        <span style={{ flexBasis: "100%", fontSize: 14, color: state.status === "ok" ? "#3f4b38" : "var(--clay)" }}>{state.message}</span>
      )}
    </form>
  );
}
