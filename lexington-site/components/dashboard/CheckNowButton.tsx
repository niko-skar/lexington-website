"use client";

import { useFormStatus } from "react-dom";

import styles from "./Dashboard.module.css";

export function CheckNowButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.btn} disabled={pending}>
      {pending ? "Checking… (up to a minute)" : "Check now"}
    </button>
  );
}
