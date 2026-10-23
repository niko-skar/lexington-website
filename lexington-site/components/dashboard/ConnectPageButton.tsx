"use client";

import { useActionState } from "react";

import { connectPageAction, type ConnectResult } from "@/lib/actions/chat";

import styles from "./Dashboard.module.css";

/** "Connect the Page": the Page's Messenger (and its Instagram) start sending their messages to the website. */
export function ConnectPageButton() {
  const [state, action, pending] = useActionState<ConnectResult | null, FormData>(() => connectPageAction(), null);
  return (
    <form action={action} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
      <button type="submit" className={styles.btn} disabled={pending}>
        {pending ? "Connecting…" : "Connect the Page"}
      </button>
      {state && (
        <span className={styles.sub}>
          {state.ok ? "Connected: new messages now come to the website." : `Not connected yet: ${state.error}`}
        </span>
      )}
    </form>
  );
}
