"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { resetBuyerPasswordAction, type ResetPasswordState } from "@/lib/actions/buyerAccounts";
import styles from "./ContactForm.module.css";
import buttonStyles from "./Button.module.css";

const initialState: ResetPasswordState = { status: "idle", message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${buttonStyles.btn} ${buttonStyles.clay} ${styles.submit}`}
    >
      {pending ? "Resetting…" : "Reset Password"}
    </button>
  );
}

export function ResetPasswordForm({ buyerId }: { buyerId: string }) {
  const [state, formAction] = useActionState(resetBuyerPasswordAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="buyerId" value={buyerId} />
      <div className={styles.field}>
        <label htmlFor="password">New Password (leave blank to auto-generate)</label>
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
