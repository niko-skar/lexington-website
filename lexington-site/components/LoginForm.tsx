"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { loginAction, type LoginState } from "@/lib/actions/login";
import styles from "./ContactForm.module.css";
import buttonStyles from "./Button.module.css";

const initialState: LoginState = { status: "idle", message: "" };

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

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <form action={formAction}>
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input type="email" id="email" name="email" required autoComplete="email" />
      </div>
      <div className={styles.field}>
        <label htmlFor="password">Password</label>
        <input type="password" id="password" name="password" required autoComplete="current-password" />
      </div>
      <SubmitButton />
      {state.status === "error" && <p className={styles.error}>{state.message}</p>}
    </form>
  );
}
