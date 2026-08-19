"use server";

import { Resend } from "resend";

import { confirmationEmail, notificationEmail } from "@/lib/email/templates";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";

export interface ContactFormState {
  status: "idle" | "success" | "error";
  message: string;
  /** Which residence the enquiry was for — surfaced so the client can attach
   *  it to the analytics conversion event on success. */
  unit?: string;
}

export async function sendEnquiry(
  _prevState: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const unit = String(formData.get("unit") || "").trim();
  const message = String(formData.get("message") || "").trim();

  if (!name || !email) {
    return { status: "error", message: "Please fill in your name and email." };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set — cannot send enquiry email.");
    return {
      status: "error",
      message: "Something went wrong on our end. Please email us directly instead.",
    };
  }

  const siteSettings = await client.fetch<SiteSettings>(siteSettingsQuery);
  const resend = new Resend(apiKey);

  const notification = notificationEmail({ name, email, phone, unit, message, siteSettings });

  try {
    const result = await resend.emails.send({
      from: "The Lexington Website <sales@lexington.com.gh>",
      to: siteSettings.notificationEmail,
      replyTo: email,
      subject: notification.subject,
      html: notification.html,
    });

    // The Resend SDK does not throw on API-level rejections — it returns
    // { data, error } — so a bad "from"/"to" or unverified domain would
    // silently report success unless we check `result.error` ourselves.
    if (result.error) {
      console.error("Resend rejected the enquiry email:", result.error);
      return {
        status: "error",
        message: "Something went wrong sending your enquiry. Please email us directly instead.",
      };
    }
  } catch (err) {
    console.error("Failed to send enquiry email:", err);
    return {
      status: "error",
      message: "Something went wrong sending your enquiry. Please email us directly instead.",
    };
  }

  // The enquiry already landed with the sales team above, so a failure on
  // this customer-facing confirmation shouldn't surface as an error to the
  // person who just submitted the form — just log it and move on.
  try {
    const confirmation = confirmationEmail({ name, unit, message, siteSettings });
    const result = await resend.emails.send({
      from: "The Lexington <sales@lexington.com.gh>",
      to: email,
      subject: confirmation.subject,
      html: confirmation.html,
    });

    if (result.error) {
      console.error("Resend rejected the confirmation email:", result.error);
    }
  } catch (err) {
    console.error("Failed to send confirmation email:", err);
  }

  return { status: "success", message: "Thanks — we'll be in touch shortly.", unit };
}
