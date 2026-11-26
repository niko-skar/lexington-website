"use client";

import { useActionState } from "react";

import { registerWhatsAppAction, type WhatsAppTestState } from "@/lib/actions/whatsappTest";

import styles from "./Dashboard.module.css";

const idle: WhatsAppTestState = { status: "idle", message: "" };

/** Switches The Lexington's WhatsApp number on for the API (Meta's "register"), with a 6-digit PIN Niko chooses. */
export function RegisterWhatsAppForm() {
  const [state, action, pending] = useActionState(registerWhatsAppAction, idle);
  return (
    <form action={action} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 10 }}>
      <input
        name="pin"
        type="password"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoComplete="new-password"
        placeholder="6-digit PIN"
        aria-label="6-digit PIN for the number"
        className={styles.input}
        style={{ minWidth: 0, flex: "0 1 170px" }}
      />
      <button type="submit" className={styles.btn} disabled={pending}>
        {pending ? "Switching on…" : "Switch on the number"}
      </button>
      {state.status !== "idle" && (
        <span style={{ flexBasis: "100%", fontSize: 14, color: state.status === "ok" ? "#3f4b38" : "var(--clay)" }}>{state.message}</span>
      )}
    </form>
  );
}
