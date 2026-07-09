"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { sendEnquiry, type ContactFormState } from "@/lib/actions/contact";
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

  return (
    <form action={formAction}>
      <div className={styles.field}>
        <label htmlFor="name">Full name</label>
        <input type="text" id="name" name="name" required />
      </div>
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input type="email" id="email" name="email" required />
      </div>
      <div className={styles.field}>
        <label htmlFor="phone">Phone / WhatsApp</label>
        <input type="tel" id="phone" name="phone" />
      </div>
      <div className={styles.field}>
        <label htmlFor="unit">Interested in</label>
        <select id="unit" name="unit" defaultValue="One Bedroom Apartment">
          <option>One Bedroom Apartment</option>
          <option>Two Bedroom Apartment</option>
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
        />
      </div>
      <SubmitButton />
      {state.status === "success" && <p className={styles.success}>{state.message}</p>}
      {state.status === "error" && <p className={styles.error}>{state.message}</p>}
      <p className={styles.note}>
        Your enquiry is sent directly to Skarlatos &amp; Son.
      </p>
    </form>
  );
}
