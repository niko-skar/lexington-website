import "server-only";
import { Resend } from "resend";

import { receiptEmail } from "@/lib/email/templates";
import { SITE_URL } from "@/lib/seo";
import { client } from "@/lib/sanity/client";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { renderReceipt } from "./build";
import { ensureReceiptNumbers } from "./issue";

// A new payment's receipt waits this long before it goes out, so a typo in the
// amount can be fixed in Studio first. The email is built from the payment as it
// stands when it's sent.
const GRACE_MINUTES = 10;
// A send that started but never finished (e.g. the server stopped) is retried after this.
const STALE_CLAIM_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const MAX_PER_RUN = 10;

const receiptDocId = (buyerId: string, paymentKey: string) => `receipt-${buyerId}-${paymentKey}`;

type SendResult = { ok: true; to: string; number: string } | { ok: false; error: string };

// Builds the receipt PDF and emails it to the buyer. Does not record anything
// itself -- callers decide what "sent" means.
export async function sendReceiptEmail(buyer: BuyerAccount, paymentKey: string): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const file = await renderReceipt(buyer, paymentKey);
  if (!file) return { ok: false, error: "That payment has no receipt." };

  const settings = await client.fetch<SiteSettings>(siteSettingsQuery);
  const mail = receiptEmail({
    name: buyer.name,
    receiptNumber: file.number,
    amountText: file.amountText,
    dateText: file.dateText,
    methodText: file.methodText,
    unitNumber: buyer.unitNumber,
    balanceText: file.balanceText,
    portalUrl: `${SITE_URL}/login`,
    siteSettings: settings,
  });

  // A copy goes to the sales inbox so there's a record of what was sent.
  const copyTo = settings.notificationEmail && settings.notificationEmail !== buyer.email ? settings.notificationEmail : undefined;

  try {
    const result = await new Resend(apiKey).emails.send({
      from: "The Lexington <sales@lexington.com.gh>",
      to: buyer.email,
      ...(copyTo && { bcc: copyTo }),
      subject: mail.subject,
      html: mail.html,
      // Base64 text, the form the email API documents for attachments.
      attachments: [{ filename: file.filename, content: Buffer.from(file.bytes).toString("base64") }],
    });
    // The Resend SDK reports API-level rejections in `error` instead of throwing.
    if (result.error) return { ok: false, error: result.error.message || "The email service refused the message." };
    return { ok: true, to: buyer.email, number: file.number };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't reach the email service." };
  }
}

export async function markReceiptEmailed(buyerId: string, paymentKey: string, to: string) {
  await getBuyersClient()
    .patch(receiptDocId(buyerId, paymentKey))
    .set({ emailedAt: new Date().toISOString(), emailedTo: to })
    .unset(["emailClaimedAt", "emailError"])
    .commit();
}

interface ReceiptRow {
  _id: string;
  _rev: string;
  buyerId: string;
  paymentKey: string;
  issuedAt?: string;
  emailedAt?: string;
  skipEmail?: boolean;
  emailClaimedAt?: string;
  emailAttempts?: number;
}

// Run on a schedule (see vercel.json). Gives every new payment a receipt number,
// and emails receipts that are due. Safe to run twice at once: a receipt is
// "claimed" with a revision check before it's sent, so nobody gets two copies.
export async function emailPendingReceipts(): Promise<{ newReceipts: number; sent: number; failed: number }> {
  const db = getBuyersClient();
  const now = Date.now();
  const minutesAgo = (iso?: string) => (iso ? (now - new Date(iso).getTime()) / 60000 : Infinity);

  const [buyers, receipts] = await Promise.all([
    db.fetch<BuyerAccount[]>(`*[_type == "buyerAccount" && role != "admin" && count(payments) > 0]`),
    db.fetch<ReceiptRow[]>(
      `*[_type == "receipt"]{ _id, _rev, buyerId, paymentKey, issuedAt, emailedAt, skipEmail, emailClaimedAt, emailAttempts }`
    ),
  ]);

  const byPayment = new Map(receipts.map((r) => [`${r.buyerId}|${r.paymentKey}`, r]));
  let newReceipts = 0;
  let sent = 0;
  let failed = 0;

  for (const buyer of buyers) {
    const payments = buyer.payments ?? [];

    // New payments: number them now. They are emailed on a later run, once the grace period is up.
    const unnumbered = payments.filter((p) => p._key && p.amount > 0 && !byPayment.has(`${buyer._id}|${p._key}`));
    if (unnumbered.length > 0) {
      await ensureReceiptNumbers(buyer._id, payments);
      newReceipts += unnumbered.length;
    }

    for (const payment of payments) {
      if (sent + failed >= MAX_PER_RUN) return { newReceipts, sent, failed };
      const row = payment._key ? byPayment.get(`${buyer._id}|${payment._key}`) : undefined;
      if (!row || row.emailedAt || row.skipEmail) continue;
      if ((row.emailAttempts ?? 0) >= MAX_ATTEMPTS) continue;
      if (minutesAgo(row.issuedAt) < GRACE_MINUTES) continue;
      if (minutesAgo(row.emailClaimedAt) < STALE_CLAIM_MINUTES) continue;

      // Claim it. If someone else claimed (or changed) it a moment ago, this is refused and we move on.
      try {
        await db.patch(row._id).ifRevisionId(row._rev).set({ emailClaimedAt: new Date().toISOString() }).commit();
      } catch {
        continue;
      }

      const result = await sendReceiptEmail(buyer, payment._key as string);
      if (result.ok) {
        await markReceiptEmailed(buyer._id, payment._key as string, result.to);
        sent++;
      } else {
        console.error(`Couldn't email receipt for payment ${payment._key} of ${buyer._id}:`, result.error);
        await db
          .patch(row._id)
          .setIfMissing({ emailAttempts: 0 })
          .inc({ emailAttempts: 1 })
          .set({ emailError: result.error.slice(0, 200) })
          .unset(["emailClaimedAt"])
          .commit();
        failed++;
      }
    }
  }

  return { newReceipts, sent, failed };
}
