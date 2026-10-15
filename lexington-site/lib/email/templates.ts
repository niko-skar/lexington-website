import type { SiteSettings } from "@/lib/sanity/types";

// Table-based layout, inline styles only — Outlook (Word rendering engine)
// and Gmail's CSS sanitizer don't reliably support flexbox/grid or
// <style> blocks, so every rule here has to survive being read cell by cell.
const FONT_SERIF = "Georgia, 'Times New Roman', serif";
const FONT_SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ctaButton(href: string, label: string) {
  return `
    <tr>
      <td style="padding:0 40px 44px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#b08d57; text-align:center;">
              <a href="${href}" style="display:inline-block; padding:14px 30px; font-family:${FONT_SANS}; font-size:13px; letter-spacing:1px; text-transform:uppercase; color:#15181a; text-decoration:none; font-weight:bold;">
                ${label}
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function shell(siteSettings: SiteSettings, bodyHtml: string) {
  return `
<div style="background:#ede7d8; padding:32px 12px; font-family:${FONT_SANS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#f7f4ec;">
  <tr>
    <td style="background:#3e596c; padding:36px 40px 30px; text-align:center;">
      <div style="font-family:${FONT_SERIF}; font-size:26px; letter-spacing:0.5px; color:#f7f4ec; line-height:1.2;">
        The&nbsp;Lexington
      </div>
      <div style="font-family:${FONT_SANS}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#d9c29a; margin-top:8px;">
        A Skarlatos &amp; Son Development
      </div>
    </td>
  </tr>
  <tr>
    <td style="background:#b08d57; height:3px; line-height:3px; font-size:0;">&nbsp;</td>
  </tr>
  ${bodyHtml}
  <tr>
    <td style="background:#2c4152; padding:32px 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-family:${FONT_SERIF}; font-size:15px; color:#f7f4ec; padding-bottom:14px;">
            The Lexington
          </td>
        </tr>
        <tr>
          <td style="font-family:${FONT_SANS}; font-size:12px; line-height:1.8; color:#c9c2b2;">
            ${escapeHtml(siteSettings.officeAddress)}<br />
            <a href="tel:${escapeHtml(siteSettings.contactPhone)}" style="color:#d9c29a; text-decoration:none;">${escapeHtml(siteSettings.contactPhone)}</a>
            &nbsp;&middot;&nbsp;
            <a href="mailto:${escapeHtml(siteSettings.contactEmail)}" style="color:#d9c29a; text-decoration:none;">${escapeHtml(siteSettings.contactEmail)}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</div>`;
}

export function confirmationEmail({
  name,
  unit,
  message,
  siteSettings,
}: {
  name: string;
  unit: string;
  message: string;
  siteSettings: SiteSettings;
}) {
  const firstName = name.trim().split(/\s+/)[0] || name;

  const body = `
    <tr>
      <td style="padding:44px 40px 8px;">
        <div style="font-family:${FONT_SERIF}; font-size:24px; color:#15181a; line-height:1.3; margin-bottom:18px;">
          Thank you for reaching out, ${escapeHtml(firstName)}.
        </div>
        <p style="font-family:${FONT_SANS}; font-size:15px; line-height:1.7; color:#3a3a36; margin:0 0 28px;">
          We've received your enquiry${unit ? ` about ${escapeHtml(unit)}` : ""} and one of our
          sales advisors will be in touch within one business day.
        </p>
      </td>
    </tr>
    ${
      message
        ? `
    <tr>
      <td style="padding:0 40px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ede7d8; border-left:3px solid #b08d57;">
          <tr>
            <td style="padding:20px 24px;">
              <div style="font-family:${FONT_SANS}; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#8b4a34; padding-bottom:8px;">Your message</div>
              <div style="font-family:${FONT_SANS}; font-size:14px; color:#3a3a36; line-height:1.6;">${escapeHtml(message).replace(/\n/g, "<br />")}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
        : ""
    }
    ${ctaButton("https://lexington.com.gh/residences", "View Residences")}`;

  return {
    subject: "We've received your enquiry — The Lexington",
    html: shell(siteSettings, body),
  };
}

// Sent to the buyer when a payment of theirs has been recorded; the PDF
// receipt travels as an attachment.
export function receiptEmail({
  name,
  receiptNumber,
  amountText,
  dateText,
  methodText,
  unitNumber,
  balanceText,
  portalUrl,
  siteSettings,
}: {
  name: string;
  receiptNumber: string;
  amountText: string;
  dateText: string;
  methodText: string;
  unitNumber: string;
  /** "USD 90,900.00" -- left out when it can't be worked out. */
  balanceText?: string;
  portalUrl: string;
  siteSettings: SiteSettings;
}) {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const rows: Array<[string, string]> = [
    ["Receipt number", receiptNumber],
    ["Amount received", amountText],
    ["Date received", dateText],
    ["Method", methodText],
    ["Residence", `Unit ${unitNumber}`],
  ];
  if (balanceText) rows.push(["Balance remaining", balanceText]);

  const body = `
    <tr>
      <td style="padding:44px 40px 8px;">
        <div style="font-family:${FONT_SERIF}; font-size:24px; color:#15181a; line-height:1.3; margin-bottom:18px;">
          Thank you, ${escapeHtml(firstName)}.
        </div>
        <p style="font-family:${FONT_SANS}; font-size:15px; line-height:1.7; color:#3a3a36; margin:0 0 28px;">
          We've received your payment towards Unit ${escapeHtml(unitNumber)}. Your receipt is attached to this
          email as a PDF, and you can download it again any time from your account.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 40px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ede7d8; border-left:3px solid #b08d57;">
          <tr>
            <td style="padding:20px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${rows
                  .map(
                    ([label, value]) => `
                <tr>
                  <td style="font-family:${FONT_SANS}; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#8b4a34; padding:5px 0; vertical-align:top;">${escapeHtml(label)}</td>
                  <td style="font-family:${FONT_SANS}; font-size:14px; color:#15181a; text-align:right; padding:5px 0;">${escapeHtml(value)}</td>
                </tr>`
                  )
                  .join("")}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${ctaButton(escapeHtml(portalUrl), "View your account")}`;

  return {
    subject: `Your payment receipt ${receiptNumber} — The Lexington`,
    html: shell(siteSettings, body),
  };
}

export function notificationEmail({
  name,
  email,
  phone,
  unit,
  message,
  siteSettings,
  crmUrl,
}: {
  name: string;
  email: string;
  phone: string;
  unit: string;
  message: string;
  siteSettings: SiteSettings;
  /** Link to this prospect in the admin CRM, when the enquiry was saved there. */
  crmUrl?: string;
}) {
  const fields: Array<[string, string]> = [
    ["Name", name],
    ["Email", email],
    ["Phone", phone || "—"],
    ["Interested in", unit || "—"],
  ];

  const body = `
    <tr>
      <td style="padding:44px 40px 8px;">
        <div style="font-family:${FONT_SERIF}; font-size:24px; color:#15181a; line-height:1.3; margin-bottom:18px;">
          New enquiry received.
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 40px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ede7d8; border-left:3px solid #b08d57;">
          <tr>
            <td style="padding:20px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${fields
                  .map(
                    ([label, value]) => `
                <tr>
                  <td style="font-family:${FONT_SANS}; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#8b4a34; padding:4px 0; vertical-align:top;">${escapeHtml(label)}</td>
                  <td style="font-family:${FONT_SANS}; font-size:14px; color:#15181a; text-align:right; padding:4px 0;">${escapeHtml(value)}</td>
                </tr>`
                  )
                  .join("")}
                <tr>
                  <td colspan="2" style="font-family:${FONT_SANS}; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#8b4a34; padding:10px 0 4px;">Message</td>
                </tr>
                <tr>
                  <td colspan="2" style="font-family:${FONT_SANS}; font-size:14px; color:#3a3a36; line-height:1.6; padding:0 0 4px;">${escapeHtml(message || "—").replace(/\n/g, "<br />")}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${
      crmUrl
        ? `
    <tr>
      <td style="padding:0 40px 24px;">
        <a href="${escapeHtml(crmUrl)}" style="font-family:${FONT_SANS}; font-size:13px; color:#8b4a34; text-decoration:underline;">Open this prospect in your CRM &rarr;</a>
      </td>
    </tr>`
        : ""
    }
    ${ctaButton(`mailto:${encodeURIComponent(email)}`, `Reply to ${escapeHtml(name.split(/\s+/)[0] || name)}`)}`;

  return {
    subject: `Enquiry - The Lexington (${name})`,
    html: shell(siteSettings, body),
  };
}

// ---- reservation requests ---------------------------------------------------

function factsBox(rows: Array<[string, string]>) {
  return `
    <tr>
      <td style="padding:0 40px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ede7d8; border-left:3px solid #b08d57;">
          <tr>
            <td style="padding:20px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${rows
                  .map(
                    ([label, value]) => `
                <tr>
                  <td style="font-family:${FONT_SANS}; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#8b4a34; padding:5px 12px 5px 0; vertical-align:top; width:38%;">${escapeHtml(label)}</td>
                  <td style="font-family:${FONT_SANS}; font-size:14px; color:#15181a; text-align:right; padding:5px 0; vertical-align:top;">${escapeHtml(value).replace(/\n/g, "<br />")}</td>
                </tr>`
                  )
                  .join("")}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// Sent to the buyer the moment they finish the reservation questions; the PDF
// reservation fee form travels as an attachment. There are no bank details in it
// or in this email: a sales advisor agrees with the buyer how they want to pay and
// sends the matching details afterwards.
export function reservationFormEmail({
  name,
  residenceText,
  amountText,
  whatsappHref,
  siteSettings,
}: {
  name: string;
  /** "Unit 205B, One bedroom" or "One bedroom (we'll confirm the unit with you)". */
  residenceText: string;
  amountText: string;
  whatsappHref: string;
  siteSettings: SiteSettings;
}) {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const steps = [
    "Open the attached form and check your name and details.",
    "One of our sales advisors will contact you to agree how you would like to pay the reservation fee, and will send you the bank details that match.",
    `Before you send any money, phone us on ${siteSettings.contactPhone} to confirm the bank details. Then email your proof of payment to ${siteSettings.contactEmail}.`,
    "We will confirm your residence in writing, and a payment receipt follows once your payment has been received.",
  ];

  const body = `
    <tr>
      <td style="padding:44px 40px 8px;">
        <div style="font-family:${FONT_SERIF}; font-size:24px; color:#15181a; line-height:1.3; margin-bottom:18px;">
          Your reservation form, ${escapeHtml(firstName)}.
        </div>
        <p style="font-family:${FONT_SANS}; font-size:15px; line-height:1.7; color:#3a3a36; margin:0 0 24px;">
          Thank you for choosing The Lexington. Your reservation fee form is attached to this email as a PDF.
        </p>
      </td>
    </tr>
    ${factsBox([
      ["Residence", residenceText],
      ["Reservation fee", amountText],
      ["Payment", "We agree it with you first"],
    ])}
    <tr>
      <td style="padding:0 40px 8px;">
        <div style="font-family:${FONT_SANS}; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#8b4a34; padding-bottom:10px;">What to do next</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${steps
            .map(
              (step, i) => `
          <tr>
            <td style="font-family:${FONT_SERIF}; font-size:18px; color:#b08d57; width:30px; vertical-align:top; padding:0 0 12px;">${i + 1}</td>
            <td style="font-family:${FONT_SANS}; font-size:14.5px; line-height:1.6; color:#3a3a36; padding:2px 0 12px;">${escapeHtml(step)}</td>
          </tr>`
            )
            .join("")}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 40px 20px;">
        <p style="font-family:${FONT_SANS}; font-size:13px; line-height:1.6; color:#6b6b66; margin:0;">
          Questions? Reply to this email or message us on WhatsApp. If you didn't ask for this form, you can ignore this email.
        </p>
      </td>
    </tr>
    ${ctaButton(escapeHtml(whatsappHref), "Message us on WhatsApp")}`;

  return {
    subject: "Your reservation form — The Lexington",
    html: shell(siteSettings, body),
  };
}

// Sent instead of the form when it can't go out automatically (the form could not
// be made, or the email service refused it): the request is safe and a person will
// send the form.
export function reservationReceivedEmail({
  name,
  residenceText,
  whatsappHref,
  siteSettings,
}: {
  name: string;
  residenceText: string;
  whatsappHref: string;
  siteSettings: SiteSettings;
}) {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const body = `
    <tr>
      <td style="padding:44px 40px 8px;">
        <div style="font-family:${FONT_SERIF}; font-size:24px; color:#15181a; line-height:1.3; margin-bottom:18px;">
          We've received your request, ${escapeHtml(firstName)}.
        </div>
        <p style="font-family:${FONT_SANS}; font-size:15px; line-height:1.7; color:#3a3a36; margin:0 0 24px;">
          Thank you for choosing The Lexington. One of our sales advisors will send you your reservation fee form
          shortly.
        </p>
      </td>
    </tr>
    ${factsBox([["Residence", residenceText]])}
    <tr>
      <td style="padding:0 40px 20px;">
        <p style="font-family:${FONT_SANS}; font-size:13px; line-height:1.6; color:#6b6b66; margin:0;">
          In the meantime you can reply to this email or message us on WhatsApp. If you didn't ask for this, you can ignore this email.
        </p>
      </td>
    </tr>
    ${ctaButton(escapeHtml(whatsappHref), "Message us on WhatsApp")}`;

  return {
    subject: "We've received your reservation request — The Lexington",
    html: shell(siteSettings, body),
  };
}

// Sent to the sales inbox with everything the visitor answered, and the form as
// an attachment so it can be forwarded by hand if it didn't go out.
export function reservationNotificationEmail({
  name,
  email,
  rows,
  outcome,
  siteSettings,
  crmUrl,
}: {
  name: string;
  email: string;
  rows: Array<[string, string]>;
  /** One line: what happened to the form (emailed / held / failed). */
  outcome: string;
  siteSettings: SiteSettings;
  crmUrl?: string;
}) {
  const body = `
    <tr>
      <td style="padding:44px 40px 8px;">
        <div style="font-family:${FONT_SERIF}; font-size:24px; color:#15181a; line-height:1.3; margin-bottom:14px;">
          New reservation request.
        </div>
        <p style="font-family:${FONT_SANS}; font-size:14.5px; line-height:1.6; color:#3a3a36; margin:0 0 22px;">${escapeHtml(outcome)}</p>
      </td>
    </tr>
    ${factsBox(rows)}
    ${
      crmUrl
        ? `
    <tr>
      <td style="padding:0 40px 24px;">
        <a href="${escapeHtml(crmUrl)}" style="font-family:${FONT_SANS}; font-size:13px; color:#8b4a34; text-decoration:underline;">Open this prospect in your CRM &rarr;</a>
      </td>
    </tr>`
        : ""
    }
    ${ctaButton(`mailto:${encodeURIComponent(email)}`, `Reply to ${escapeHtml(name.split(/\s+/)[0] || name)}`)}`;

  return {
    subject: `Reservation request - The Lexington (${name})`,
    html: shell(siteSettings, body),
  };
}
