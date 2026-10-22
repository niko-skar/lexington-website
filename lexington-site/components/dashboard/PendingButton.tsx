"use client";

import { useFormStatus } from "react-dom";

import styles from "./Dashboard.module.css";

/** A form's submit button that says what is happening while the form is sent. */
export function PendingButton({ label, pendingLabel, primary = false }: { label: string; pendingLabel: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={primary ? styles.btnPrimary : styles.btn} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
