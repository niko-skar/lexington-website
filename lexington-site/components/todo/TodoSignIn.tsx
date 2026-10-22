"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { adminLoginAction, type AdminLoginState } from "@/lib/actions/adminAuth";
import { loginAction, type LoginState } from "@/lib/actions/login";
import styles from "./Todo.module.css";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.sheetSave} disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

/** The site app's own sign-in, so the home-screen app never has to leave it. */
export function TodoSignIn({ next = "/todo" }: { next?: string }) {
  const [office, setOffice] = useState(false);
  const [state, signIn] = useActionState<LoginState, FormData>(loginAction, { status: "idle", message: "" });
  const [officeState, officeSignIn] = useActionState<AdminLoginState, FormData>(adminLoginAction, { status: "idle", message: "" });

  useEffect(() => {
    navigator.serviceWorker?.register("/todo-sw.js", { scope: "/todo" }).catch(() => {});
  }, []);

  return (
    <div className={styles.app}>
      <main className={styles.signIn}>
        <p className={styles.brand}>The Lexington</p>
        <h1 className={styles.signInTitle}>Site to-do</h1>
        <p className={styles.sheetNote}>Jobs on site with a photo and a note, and the store room. Sign in to carry on.</p>

        {office ? (
          <form action={officeSignIn} className={styles.signInForm}>
            <input type="hidden" name="next" value={next} />
            <label className={styles.smallLabel} htmlFor="todo-office-password">
              Office password
            </label>
            <input id="todo-office-password" className={styles.input} type="password" name="password" required autoComplete="current-password" />
            {officeState.status === "error" && <p className={styles.sheetError}>{officeState.message}</p>}
            <Submit />
            <button type="button" className={styles.linkButton} onClick={() => setOffice(false)}>
              Sign in with an email instead
            </button>
          </form>
        ) : (
          <form action={signIn} className={styles.signInForm}>
            <input type="hidden" name="next" value={next} />
            <label className={styles.smallLabel} htmlFor="todo-email">
              Email
            </label>
            <input id="todo-email" className={styles.input} type="email" name="email" required autoComplete="email" inputMode="email" />
            <label className={styles.smallLabel} htmlFor="todo-password">
              Password
            </label>
            <input id="todo-password" className={styles.input} type="password" name="password" required autoComplete="current-password" />
            {state.status === "error" && <p className={styles.sheetError}>{state.message}</p>}
            <Submit />
            <button type="button" className={styles.linkButton} onClick={() => setOffice(true)}>
              Office: use the admin password
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
