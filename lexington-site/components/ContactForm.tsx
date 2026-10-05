"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { sendEnquiry, type ContactFormState } from "@/lib/actions/contact";
import { trackLead } from "@/lib/analytics";
import styles from "./ContactForm.module.css";
import buttonStyles from "./Button.module.css";

const initialState: ContactFormState = { status: "idle", message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${buttonStyles.btn} ${buttonStyles.clay} ${styles.submit}`}
    >
      {pending ? "Sending…" : "Send Enquiry"}
    </button>
  );
}

export function ContactForm() {
  const [state, formAction] = useActionState(sendEnquiry, initialState);

  // Fire the lead conversion once the server action confirms success — the
  // reliable success signal for a server-action form (no onSubmit needed).
  useEffect(() => {
    if (state.status === "success") {
      trackLead({ unit: state.unit });
    }
  }, [state]);

  // React empties a form once its action finishes, success or not. After a
  // failure that threw away what the visitor had typed, so the server sends it
  // back and the form is rebuilt with it (a new `key` is what makes a <select>
  // pick up its new value, too).
  const kept = state.status === "error" ? state.values : undefined;
  const formKey = kept ? JSON.stringify(kept) : "fresh";

  return (
    <form action={formAction} key={formKey}>
      <div className={styles.field}>
        <label htmlFor="name">Full name</label>
        <input type="text" id="name" name="name" required autoComplete="name" defaultValue={kept?.name} />
      </div>
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input type="email" id="email" name="email" required autoComplete="email" defaultValue={kept?.email} />
      </div>
      <div className={styles.field}>
        <label htmlFor="phone">Phone / WhatsApp</label>
        <input type="tel" id="phone" name="phone" autoComplete="tel" defaultValue={kept?.phone} />
      </div>
      <div className={styles.field}>
        <label htmlFor="unit">Interested in</label>
        <select id="unit" name="unit" defaultValue={kept?.unit || "One Bedroom Apartment"}>
          <option>Studio Apartment</option>
          <option>One Bedroom Apartment</option>
          <option>Two Bedroom Apartment</option>
          <option>Three Bedroom Apartment</option>
          <option>Three Bedroom Duplex Penthouse</option>
          <option>Not sure yet</option>
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="message">Message</label>
        <textarea
          id="message"
          name="message"
          placeholder="Tell us about your timeline and financing preference."
          defaultValue={kept?.message}
        />
      </div>
      {/* Honeypot — invisible to real visitors (off-screen, unreachable by
          tab, hidden from screen readers), but a bot that blindly fills
          every field will fill this one too, so the server action can
          silently drop the submission. Deliberately NOT called "company",
          "website" or anything else a browser's autofill knows: autofill would
          fill it for a real visitor and their enquiry would vanish without a
          word. */}
      <div style={{ position: "absolute", left: "-9999px", top: "auto" }} aria-hidden="true">
        <label htmlFor="website_url">Leave this empty</label>
        <input type="text" id="website_url" name="website_url" tabIndex={-1} autoComplete="off" />
      </div>
      <SubmitButton />
      {state.status === "success" && <p className={styles.success}>{state.message}</p>}
      {state.status === "error" && <p className={styles.error}>{state.message}</p>}
      <p className={styles.note}>
        Your enquiry is sent directly to Skarlatos &amp; Son, and we keep your
        details so we can follow up with you.
      </p>
    </form>
  );
}
