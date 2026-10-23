"use server";

import { after } from "next/server";
import { Resend } from "resend";

import { respondToNewLead } from "@/lib/agents/leadReply";
import { notifyOwner } from "@/lib/alerts/notify";
import { saveWebsiteLead } from "@/lib/crmIntake";
import { confirmationEmail, notificationEmail } from "@/lib/email/templates";
import { whatsappUrl } from "@/lib/format";
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

  // Save the enquiry as a prospect in the CRM before anything else, so it is
  // captured even if the email provider is down. Never throws.
  const leadId = email.includes("@")
    ? await saveWebsiteLead({ name, email, phone, unit, message })
    : null;

  // Niko hears about it in the site app: an alert that buzzes his phone (Niko, 23 Oct 2026:
  // "stop all emails to me for notifications"). Never throws.
  const alerted = await notifyOwner({
    kind: "enquiry",
    urgent: true,
    title: `Website enquiry: ${name}${unit ? ` (${unit})` : ""}`,
    lines: [
      [email, phone].filter(Boolean).join(" · "),
      ...(message ? [`“${message}”`] : []),
      leadId ? "A suggested first reply will be on their record in a minute." : "It could not be saved in Prospects: add them by hand.",
    ],
    links: [
      ...(leadId ? [{ label: "Open their record", url: `/admin/crm/${leadId}` }] : []),
      ...(phone ? [{ label: "WhatsApp them", url: whatsappUrl(phone) }] : []),
    ],
  });

  const apiKey = process.env.RESEND_API_KEY;
  const resend = apiKey ? new Resend(apiKey) : null;
  if (!resend) console.error("RESEND_API_KEY is not set: no enquiry emails can go out.");
  const siteSettings = await client.fetch<SiteSettings>(siteSettingsQuery);

  // Only when the alert could not be saved does the old email go to the sales inbox, so an
  // enquiry is never lost. With neither it, the record nor the alert, the visitor is asked to
  // email us instead.
  if (!alerted) {
    let emailed = false;
    if (resend) {
      try {
        const notification = notificationEmail({
          name,
          email,
          phone,
          unit,
          message,
          siteSettings,
          crmUrl: leadId ? `${SITE_URL}/admin/crm/${leadId}` : undefined,
          replyComing: Boolean(leadId),
        });
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
        if (result.error) console.error("Resend rejected the enquiry email:", result.error);
        else emailed = true;
      } catch (err) {
        console.error("Failed to send enquiry email:", err);
      }
    }
    if (!emailed && !leadId) {
      return {
        status: "error",
        message: "Something went wrong sending your enquiry. Please email us directly instead.",
        values,
      };
    }
  }

  // The enquiry has already landed with us above, so a failure on this
  // customer-facing confirmation shouldn't surface as an error to the
  // person who just submitted the form — just log it and move on.
  if (resend) {
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
  }

  // The lead responder writes a suggested first reply once the visitor already has
  // their answer: it takes a little while and must never hold up the form.
  if (leadId) after(() => respondToNewLead(leadId, { message }));

  return { status: "success", message: "Thanks — we'll be in touch shortly.", unit };
}
