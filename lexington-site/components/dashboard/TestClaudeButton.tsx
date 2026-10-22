"use client";

import { useActionState } from "react";

import { testClaudeAction, type ClaudeTestState } from "@/lib/actions/claudeTest";

import styles from "./Dashboard.module.css";

const idle: ClaudeTestState = { status: "idle", message: "" };

export function TestClaudeButton() {
  const [state, action, pending] = useActionState(testClaudeAction, idle);
  return (
    <form action={action} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 10 }}>
      <button type="submit" className={styles.btn} disabled={pending}>
        {pending ? "Testing…" : "Test it"}
      </button>
      {state.status !== "idle" && (
        <span style={{ fontSize: 14, color: state.status === "ok" ? "#3f4b38" : "var(--clay)" }}>{state.message}</span>
      )}
    </form>
  );
}
