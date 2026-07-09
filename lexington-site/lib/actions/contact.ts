"use server";

import { Resend } from "resend";

import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";

export interface ContactFormState {
  status: "idle" | "success" | "error";
  message: string;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

  try {
    const result = await resend.emails.send({
      from: "The Lexington Website <sales@lexington.com.gh>",
      to: siteSettings.notificationEmail,
      replyTo: email,
      subject: `Enquiry - The Lexington (${name})`,
      html: `
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone || "—")}</p>
        <p><strong>Interested in:</strong> ${escapeHtml(unit || "—")}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message || "—").replace(/\n/g, "<br />")}</p>
      `,
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

    return { status: "success", message: "Thanks — we'll be in touch shortly." };
  } catch (err) {
    console.error("Failed to send enquiry email:", err);
    return {
      status: "error",
      message: "Something went wrong sending your enquiry. Please email us directly instead.",
    };
  }
}
