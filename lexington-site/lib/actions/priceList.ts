"use server";

import { headers } from "next/headers";
import { Resend } from "resend";

import { notifyOwner } from "@/lib/alerts/notify";
import { firstName } from "@/lib/crm";
import { savePriceListLead } from "@/lib/crmIntake";
import { priceListEmail } from "@/lib/email/templates";
import { formatUSD, whatsappUrl } from "@/lib/format";
import { parsePriceListContact } from "@/lib/priceList/contact";
import { PRICE_LIST_PATH, priceListFileName, type PriceListData } from "@/lib/priceList/data";
import { loadPriceList } from "@/lib/priceList/load";
import { buildPriceListPdf } from "@/lib/priceList/pdf";
import { allow, connectionKey } from "@/lib/reservation/limit";
import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { SITE_URL } from "@/lib/seo";
import { pageName } from "@/lib/visits/rules";

// "Send me the price list" (Niko, 25 Nov 2026: item 3 of the website plan, for the visitors not ready to talk). They
// leave a name and an email or a WhatsApp number; an email gets today's price list as a PDF at once; everyone can open it
// on the page straight away; they become a prospect with a step to follow up, and Niko gets an alert (with a one-tap
// WhatsApp carrying the price list link when they gave a number).

export interface PriceListFormState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string>;
  /** Where it went: "email" (sent), "whatsapp" (the team sends it), or "email-failed". */
  sentTo?: "email" | "whatsapp" | "email-failed";
  email?: string;
  firstName?: string;
}

// A name and one more box take longer than this.
const MIN_FILL_MS = 2500;
const FROM = "The Lexington <sales@lexington.com.gh>";

const text = (formData: FormData, name: string, max: number) => String(formData.get(name) ?? "").trim().slice(0, max);

/** The CRM's source for a brand-new prospect, from the advert that brought them (utm_source), as for site visits. */
function leadSourceFrom(utm: string): string {
  const s = utm.toLowerCase();
  if (/facebook|instagram|\bfb\b|\big\b|meta/.test(s)) return "meta_ads";
  if (/google|adwords|gads/.test(s)) return "google_ads";
  return "website";
}

export async function requestPriceList(_prev: PriceListFormState, formData: FormData): Promise<PriceListFormState> {
  // Honeypot: a real visitor never sees this field. A bot is told "thank you" and nothing happens.
  if (text(formData, "website_url", 200)) return { status: "success", message: "Thank you.", sentTo: "whatsapp" };

  const startedAt = Number(formData.get("started"));
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FILL_MS) {
    return { status: "error", message: "That was very quick. Please check your details, then press the button again." };
  }

  const name = text(formData, "name", 120).replace(/\s+/g, " ");
  const contact = parsePriceListContact(text(formData, "contact", 160));
  const errors: Record<string, string> = {};
  if (name.length < 2 || !/\p{L}/u.test(name)) errors.name = "Please enter your name.";
  if (!contact) errors.contact = "Please enter your email address, or your WhatsApp number with the country code.";
  if (!contact || Object.keys(errors).length) return { status: "error", message: "Please check the details marked below.", fieldErrors: errors };

  // A speed bump per connection (loose: many phones share one address) and for the whole site.
  const key = connectionKey(await headers());
  if (!allow(`pricelist:${key}`, 5, 30 * 60_000) || !allow("pricelist:all", 150, 60 * 60_000)) {
    return { status: "error", message: "We've had a lot of requests from this connection. Please try again in a little while, or WhatsApp us." };
  }

  const fromPath = text(formData, "from", 60);
  const where = /^\/[a-z0-9/-]*$/.test(fromPath) ? pageName(fromPath) : "the website";
  const utm = text(formData, "utm_source", 80);
  const adSource = utm.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40);
  const first = firstName(name);
  const email = contact.kind === "email" ? contact.email : "";
  const phone = contact.kind === "whatsapp" ? contact.phone : "";

  const [settings, made] = await Promise.all([
    client.fetch<SiteSettings>(siteSettingsQuery),
    (async () => {
      try {
        const data = await loadPriceList();
        return { data, pdf: await buildPriceListPdf(data) };
      } catch (error) {
        console.error("[price list] could not be made:", error instanceof Error ? error.message : error);
        return null;
      }
    })(),
  ]);
  const link = `${SITE_URL}${PRICE_LIST_PATH}`;

  // 1) The email, with the PDF.
  let emailed = false;
  if (email && made) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) console.error("RESEND_API_KEY is not set: the price list can't be emailed.");
    else {
      try {
        const mail = priceListEmail({
          name,
          kinds: kindsAtAGlance(made.data),
          offerLine: made.data.offer ? `${made.data.offer.headline}: ${made.data.offer.detail}` : "",
          vatOn: made.data.vatOn,
          links: { residences: made.data.links.residences, visit: made.data.links.visit },
          whatsappHref: whatsappUrl(settings.contactPhone, `Hi, I'm ${first}. I've just received your price list.`),
          siteSettings: settings,
        });
        const result = await new Resend(apiKey).emails.send({
          from: FROM,
          to: email,
          replyTo: settings.contactEmail,
          subject: mail.subject,
          html: mail.html,
          attachments: [{ filename: priceListFileName(made.data.issuedOn), content: Buffer.from(made.pdf).toString("base64") }],
        });
        if (result.error) console.error("[price list] Resend refused the email:", result.error);
        else emailed = true;
      } catch (error) {
        console.error("[price list] the email could not be sent:", error instanceof Error ? error.message : error);
      }
    }
  }

  // 2) Their record in Prospects, with what happened and the next step.
  const outcome = emailed
    ? `Emailed to ${email} with the PDF.`
    : email
      ? `The email to ${email} did NOT go out: send them the price list by hand (${link}).`
      : `They gave a WhatsApp number: send them the price list on WhatsApp (${link}).`;
  const leadId = await savePriceListLead({
    name,
    email,
    phone,
    source: leadSourceFrom(utm),
    adSource,
    note: `Asked for the price list on the website (${where}). ${outcome}`,
    task: emailed
      ? { text: `Follow up with ${first}: they have the price list`, dueInDays: 1, waitingOn: "me" }
      : { text: `Send ${first} the price list${phone ? " on WhatsApp" : " by email"}`, dueInDays: 0, waitingOn: "me" },
  });

  // 3) Niko: a new prospect, with a one-tap WhatsApp when they gave a number.
  await notifyOwner({
    kind: "enquiry",
    urgent: true,
    title: `Price list: ${name}`,
    lines: [
      `Asked for the price list on the website (${where}).`,
      outcome,
      [email, phone].filter(Boolean).join(" · "),
      leadId ? "" : "It could not be saved in Prospects: add them by hand.",
    ].filter(Boolean),
    links: [
      ...(leadId ? [{ label: "Their record", url: `/admin/crm/${leadId}` }] : []),
      ...(phone
        ? [
            {
              label: "WhatsApp the price list",
              url: whatsappUrl(phone, `Hi ${first}, this is The Lexington. Here is our price list, with every home still for sale: ${link} Would you like to see the building, in person or on a video call?`),
            },
          ]
        : []),
    ],
  });

  return {
    status: "success",
    message: emailed ? "The price list is on its way to your inbox." : "Here is your price list.",
    sentTo: emailed ? "email" : email ? "email-failed" : "whatsapp",
    email,
    firstName: first,
  };
}

/** Each kind of home in a line for the email: "Studios", "from $76,800", "9 available". */
function kindsAtAGlance(data: PriceListData) {
  return data.kinds
    .filter((k) => k.available > 0)
    .map((k) => ({ label: k.label, from: k.from !== null ? `from ${formatUSD(k.from)}${data.vatSuffix}` : "", available: `${k.available} available` }));
}
