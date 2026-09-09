"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { createBuyerAccountAction, type CreateBuyerState } from "@/lib/actions/buyerAccounts";
import styles from "./ContactForm.module.css";
import buttonStyles from "./Button.module.css";

const initialState: CreateBuyerState = { status: "idle", message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${buttonStyles.btn} ${buttonStyles.clay} ${styles.submit}`}
    >
      {pending ? "Creating…" : "Create Account"}
    </button>
  );
}

export function CreateBuyerForm() {
  const [state, formAction] = useActionState(createBuyerAccountAction, initialState);

  return (
    <form action={formAction}>
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input type="email" id="email" name="email" required />
      </div>
      <div className={styles.field}>
        <label htmlFor="name">Name</label>
        <input type="text" id="name" name="name" required />
      </div>
      <div className={styles.field}>
        <label htmlFor="unitNumber">Unit Number</label>
        <input type="text" id="unitNumber" name="unitNumber" placeholder="e.g. 302A" required />
      </div>
      <div className={styles.field}>
        <label htmlFor="contractPriceUSD">Contract Price (USD)</label>
        <input type="number" id="contractPriceUSD" name="contractPriceUSD" min="1" step="1" required />
      </div>
      <div className={styles.field}>
        <label htmlFor="password">Password (leave blank to auto-generate)</label>
        <input type="text" id="password" name="password" autoComplete="off" />
      </div>
      <SubmitButton />
      {state.status === "error" && <p className={styles.error}>{state.message}</p>}
      {state.status === "success" && (
        <p className={styles.success}>
          {state.message} Password: <strong>{state.generatedPassword}</strong> — copy this now,
          it won&rsquo;t be shown again.
        </p>
      )}
    </form>
  );
}
