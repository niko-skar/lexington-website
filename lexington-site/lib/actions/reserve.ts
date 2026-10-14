"use server";

import { headers } from "next/headers";
import { Resend } from "resend";

import { firstName } from "@/lib/crm";
import { countRecentReservationRequests, noteOnLead, saveReservationLead } from "@/lib/crmIntake";
import {
  reservationFormEmail,
  reservationNotificationEmail,
  reservationReceivedEmail,
} from "@/lib/email/templates";
import { whatsappUrl } from "@/lib/format";
import {
  CRM_PAYMENT,
  CRM_SOURCE_FROM_HEARD,
  RESERVATION_FEE_USD,
  unitTypeFor,
} from "@/lib/reservation/config";
import { allow, connectionKey } from "@/lib/reservation/limit";
import { buildReservationFormPdf } from "@/lib/reservation/pdf";
import { getReservationSettings } from "@/lib/reservation/settings";
import {
  answerRows,
  crmSummary,
  interestText,
  residenceText,
  type UnitFacts,
} from "@/lib/reservation/summary";
import { parseReservation } from "@/lib/reservation/validate";
import { SITE_URL } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery, unitByNumberQuery } from "@/lib/sanity/queries";
import type { SiteSettings, Unit } from "@/lib/sanity/types";

export interface ReserveFormState {
  status: "idle" | "success" | "error";
  message: string;
  /** After an error: the step the visitor should be taken back to (1 to 4). */
  step?: number;
  fieldErrors?: Record<string, string>;
  /** Which residence they asked for, so the page can attach it to the analytics event. */
  unit?: string;
  email?: string;
  firstName?: string;
  /** False when the form could not go out by email: a person will send it. */
  emailed?: boolean;
}

// Nobody can read four steps of questions and answer them in less than this.
const MIN_FILL_MS = 6000;
const FROM = "The Lexington <sales@lexington.com.gh>";

const ok = (message: string, extra: Partial<ReserveFormState> = {}): ReserveFormState => ({
  status: "success",
  message,
  ...extra,
});
const fail = (message: string, extra: Partial<ReserveFormState> = {}): ReserveFormState => ({
  status: "error",
  message,
  ...extra,
});

export async function submitReservation(
  _prevState: ReserveFormState,
  formData: FormData
): Promise<ReserveFormState> {
  // Honeypot: a real visitor never sees this field. A bot gets a "success" and
  // nothing is sent, so it has no signal to adapt to.
  if (String(formData.get("website_url") || "").trim()) {
    return ok("Thank you.", { emailed: true, email: "your email", firstName: "there" });
  }

  const startedAt = Number(formData.get("started"));
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FILL_MS) {
    return fail("That was very quick. Please check your answers, then press the button again.", { step: 4 });
  }

  const parsed = parseReservation(formData);
  if (!parsed.ok) return fail(parsed.message, { step: parsed.step, fieldErrors: parsed.fieldErrors });
  const input = parsed.input;

  // Speed bump per connection (loose: many phones share one network address), then the
  // real limit per email address.
  const key = connectionKey(await headers());
  if (!allow(`ip:${key}`, 10, 30 * 60_000) || !allow("all", 150, 60 * 60_000)) {
    return fail("We've had a lot of requests from this connection. Please try again in a little while, or call us.", { step: 4 });
  }
  if ((await countRecentReservationRequests(input.email)) >= 3) {
    return fail(
      "We've already sent the reservation form to this address today. Please check your inbox (and your spam folder), or message us on WhatsApp.",
      { step: 1, fieldErrors: { email: "The form has already been sent to this address today." } }
    );
  }

  const [siteSettings, settings] = await Promise.all([
    client.fetch<SiteSettings>(siteSettingsQuery),
    getReservationSettings(),
  ]);

  // The unit they picked: check it is real and still available right now.
  let unit: Unit | null = null;
  if (input.unit) {
    unit = await client.fetch<Unit | null>(unitByNumberQuery, { unitNumber: input.unit });
    if (!unit) {
      return fail("We couldn't find that residence. Please choose one from the list.", {
        step: 2,
        fieldErrors: { unit: "We couldn't find that residence." },
      });
    }
    if (unit.status !== "available") {
      return fail(`Unit ${unit.unitNumber} has just been taken. Please choose another residence.`, {
        step: 2,
        fieldErrors: { unit: `Unit ${unit.unitNumber} is no longer available.` },
      });
    }
  }
  const facts: UnitFacts | null = unit
    ? { unitNumber: unit.unitNumber, bedroomType: unit.bedroomType, floor: unit.floor, areaSqm: unit.areaSqm, priceUSD: unit.priceUSD }
    : null;
  const type = unitTypeFor(unit?.bedroomType ?? input.unitType);
  const residence = residenceText(input, facts);
  const first = firstName(input.name);

  // Keep the request first, so it is never lost even if everything after fails.
  const leadId = await saveReservationLead({
    name: input.name,
    email: input.email,
    phone: input.phone,
    interest: interestText(input, facts),
    unitNumber: unit?.unitNumber ?? "",
    paymentPreference: CRM_PAYMENT[input.payment] ?? "undecided",
    source: CRM_SOURCE_FROM_HEARD[input.heard] ?? "website",
    summary: crmSummary(input, facts),
    tasks: [
      { text: `Get in touch with ${first}: they asked to reserve (see the notes)`, dueInDays: 0, waitingOn: "me" },
      { text: `Check whether ${first} has sent the US$${RESERVATION_FEE_USD.toLocaleString("en-US")} reservation fee`, dueInDays: 3, waitingOn: "them" },
    ],
  });
  const crmUrl = leadId ? `${SITE_URL}/admin/crm/${leadId}` : undefined;

  // The form itself.
  let pdf: Uint8Array | null = null;
  let held = ""; // why the form was not sent, in plain words
  if (!settings) {
    held = "the reservation form settings (bank details) aren't complete, so no form could be made";
  } else {
    try {
      pdf = await buildReservationFormPdf({
        buyerName: input.name,
        unitNumber: unit?.unitNumber,
        apartmentFact: type?.fact ?? "To be confirmed",
        apartmentLine: type?.line ?? "Apartment to be confirmed",
        amountUSD: RESERVATION_FEE_USD,
        issuedOn: new Date().toISOString().slice(0, 10),
        bank: {
          owner: settings.accountOwner,
          bank: settings.bankName,
          account: settings.accountNumber,
          routing: settings.routingNumber,
          address: settings.accountAddress,
          extra: settings.extraLines,
          reference: settings.paymentReference,
        },
        contact: { phone: siteSettings.contactPhone, email: siteSettings.contactEmail, address: siteSettings.officeAddress },
      });
    } catch (err) {
      console.error("Could not build the reservation form:", err);
      held = "the reservation form could not be made";
    }
    if (pdf && !settings.autoSend) held = "automatic sending is switched off in the reservation form settings";
  }

  const apiKey = process.env.RESEND_API_KEY;
  const resend = apiKey ? new Resend(apiKey) : null;
  if (!resend) console.error("RESEND_API_KEY is not set: no reservation emails can go out.");

  const sendForm = Boolean(pdf) && !held && Boolean(resend);
  const amountText = `USD ${RESERVATION_FEE_USD.toLocaleString("en-US")}`;
  const whatsappHref = whatsappUrl(siteSettings.contactPhone, `Hi, I'm ${first}. I've asked for my reservation form for The Lexington.`);
  const attachment = pdf
    ? [{ filename: "Reservation-fee-form-The-Lexington.pdf", content: Buffer.from(pdf).toString("base64") }]
    : undefined;

  // 1) The buyer: the form itself, or a "we have your request" note when it can't go out by itself.
  let buyerMailOk = false;
  if (resend) {
    try {
      const mail = sendForm
        ? reservationFormEmail({ name: input.name, residenceText: residence, amountText, whatsappHref, siteSettings })
        : reservationReceivedEmail({ name: input.name, residenceText: residence, whatsappHref, siteSettings });
      const result = await resend.emails.send({
        from: FROM,
        to: input.email,
        replyTo: siteSettings.contactEmail,
        subject: mail.subject,
        html: mail.html,
        ...(sendForm && attachment ? { attachments: attachment } : {}),
      });
      // The Resend SDK reports API-level rejections in `error` instead of throwing.
      if (result.error) console.error("Resend rejected the reservation email to the buyer:", result.error);
      else buyerMailOk = true;
    } catch (err) {
      console.error("Failed to send the reservation email to the buyer:", err);
    }
  }
  const formEmailed = sendForm && buyerMailOk;

  // 2) The sales inbox: everything they answered, and the form to forward if it didn't go out.
  const outcome = formEmailed
    ? `The reservation fee form was emailed to ${input.email}.`
    : buyerMailOk
      ? `The form was NOT sent automatically (${held}). They were told a sales advisor will send it. ${pdf ? "The form is attached: forward it to them." : ""}`.trim()
      : `The email to ${input.email} did NOT go out. Send them the reservation form by hand. ${pdf ? "It is attached." : "(No form could be made either.)"}`.trim();
  let notifyOk = false;
  if (resend) {
    try {
      const mail = reservationNotificationEmail({
        name: input.name,
        email: input.email,
        rows: answerRows(input, facts),
        outcome,
        siteSettings,
        crmUrl,
      });
      const result = await resend.emails.send({
        from: "The Lexington Website <sales@lexington.com.gh>",
        to: siteSettings.notificationEmail,
        replyTo: input.email,
        subject: mail.subject,
        html: mail.html,
        ...(attachment ? { attachments: attachment } : {}),
      });
      if (result.error) console.error("Resend rejected the reservation notification:", result.error);
      else notifyOk = true;
    } catch (err) {
      console.error("Failed to send the reservation notification:", err);
    }
  }

  // 3) The prospect's timeline: what actually happened.
  if (leadId) {
    const copy = pdf && notifyOk ? " The form is attached to the email sent to sales." : " No email could be sent at all, so make the form by hand.";
    const what = buyerMailOk
      ? `The form was NOT sent automatically (${held}). ${input.email} was told a sales advisor will send it.${pdf && notifyOk ? copy : ""}`
      : `The email to ${input.email} did NOT go out. Send them the reservation form by hand.${copy}`;
    await noteOnLead(
      leadId,
      formEmailed ? `Reservation fee form emailed to ${input.email}.` : what,
      formEmailed ? undefined : { text: `Send ${first} the reservation form by hand`, dueInDays: 0, waitingOn: "me" }
    );
  }

  return ok(
    formEmailed
      ? "The reservation form is on its way to your inbox."
      : "We have your request. We couldn't send the form automatically, so a sales advisor will email it to you shortly.",
    { unit: unit?.unitNumber, email: input.email, firstName: first, emailed: formEmailed }
  );
}
