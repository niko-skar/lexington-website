"use client";

import styles from "@/components/Portal.module.css";

export default function AccountError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className={styles.page}>
      <div className={styles.eyebrow}>My Account</div>
      <h1 className={styles.title}>Something went wrong</h1>
      <p className={styles.empty} style={{ marginBottom: "var(--space-6)" }}>
        {error.message.startsWith("Missing NEXT_PUBLIC_SANITY_BUYERS_DATASET") ||
        error.message.includes("SANITY_BUYERS_API_TOKEN")
          ? "The buyer portal isn't fully set up yet — please check back shortly, or contact us if this persists."
          : "Couldn't load your account. Please try again."}
      </p>
      <button
        onClick={reset}
        style={{
          background: "var(--clay)",
          color: "var(--paper)",
          padding: "12px 24px",
          borderRadius: "var(--radius)",
          fontSize: 13.5,
          fontWeight: 600,
        }}
      >
        Try Again
      </button>
    </main>
  );
}
