"use client";

import { useRef } from "react";
import styles from "./ContactForm.module.css";
import buttonStyles from "./Button.module.css";

const CONTACT_EMAIL = "sales@lexington.com.gh";

export function ContactForm() {
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current;
    if (!form) return;

    const name = (form.elements.namedItem("name") as HTMLInputElement).value;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const phone = (form.elements.namedItem("phone") as HTMLInputElement).value;
    const unit = (form.elements.namedItem("unit") as HTMLSelectElement).value;
    const message = (form.elements.namedItem("message") as HTMLTextAreaElement).value;

    const body = `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nInterested in: ${unit}\n\n${message}`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      "Enquiry - The Lexington"
    )}&body=${encodeURIComponent(body)}`;
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
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
      <button type="submit" className={`${buttonStyles.btn} ${buttonStyles.clay} ${styles.submit}`}>
        Send Enquiry
      </button>
      <p className={styles.note}>
        This opens your email client addressed to Skarlatos &amp; Son with
        your details pre-filled.
      </p>
    </form>
  );
}
