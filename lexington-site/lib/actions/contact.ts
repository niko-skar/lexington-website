"use server";

import { Resend } from "resend";

import { saveWebsiteLead } from "@/lib/crmIntake";
import { confirmationEmail, notificationEmail } from "@/lib/email/templates";
import { SITE_URL } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";

export interface ContactFormState {
  status: "idle" | "success" | "error";
  message: string;
  /** Which residence the enquiry was for — surfaced so the client can attach
   *  it to the analytics conversion event on success. */
  unit?: string;
  /** What was typed, sent back on an error so the form can keep it. */
  values?: { name: string; email: string; phone: string; unit: string; message: string };
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
  const values = { name, email, phone, unit, message };

  // Honeypot — a real visitor never sees or fills this field (it's
  // off-screen and unreachable by tab), so anything here means a bot.
  // Report success without sending mail, so the bot has no signal to
  // adapt its behavior.
  if (String(formData.get("website_url") || "").trim()) {
    return { status: "success", message: "Thanks — we'll be in touch shortly.", unit };
  }

  if (!name || !email) {
    return { status: "error", message: "Please fill in your name and email.", values };
  }

  // Save the enquiry as a prospect in the CRM before any email work, so it is
  // captured even if the email provider is down. Never throws.
  const leadId = email.includes("@")
    ? await saveWebsiteLead({ name, email, phone, unit, message })
    : null;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set — cannot send enquiry email.");
    return {
      status: "error",
      message: "Something went wrong on our end. Please email us directly instead.",
      values,
    };
  }

  const siteSettings = await client.fetch<SiteSettings>(siteSettingsQuery);
  const resend = new Resend(apiKey);

  const notification = notificationEmail({
    name,
    email,
    phone,
    unit,
    message,
    siteSettings,
    crmUrl: leadId ? `${SITE_URL}/admin/crm/${leadId}` : undefined,
  });

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
        values,
      };
    }
  } catch (err) {
    console.error("Failed to send enquiry email:", err);
    return {
      status: "error",
      message: "Something went wrong sending your enquiry. Please email us directly instead.",
      values,
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
