"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { adminLoginAction, type AdminLoginState } from "@/lib/actions/adminAuth";
import styles from "./ContactForm.module.css";
import buttonStyles from "./Button.module.css";

const initialState: AdminLoginState = { status: "idle", message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${buttonStyles.btn} ${buttonStyles.clay} ${styles.submit}`}
    >
      {pending ? "Signing in…" : "Sign In"}
    </button>
  );
}

export function AdminLoginForm() {
  const [state, formAction] = useActionState(adminLoginAction, initialState);

  return (
    <form action={formAction}>
      <div className={styles.field}>
        <label htmlFor="password">Admin Password</label>
        <input type="password" id="password" name="password" required autoComplete="current-password" />
      </div>
      <SubmitButton />
      {state.status === "error" && <p className={styles.error}>{state.message}</p>}
    </form>
  );
}
