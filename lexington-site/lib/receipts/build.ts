import "server-only";

import { formatMethod, usdEquivalent } from "@/lib/currency";
import { client } from "@/lib/sanity/client";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";
import { siteSettingsQuery, unitByNumberQuery } from "@/lib/sanity/queries";
import type { SiteSettings, Unit } from "@/lib/sanity/types";
import { formatFloor } from "@/lib/format";
import { byDateThenKey, ensureReceiptNumbers } from "./issue";
import { buildReceiptPdf, longDate } from "./pdf";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "Mobile money (MoMo)",
  "bank-transfer": "Bank transfer",
};

// The receipt for one payment on one buyer's account, as a PDF. Returns null
// if the payment doesn't exist on that account.
export interface RenderedReceipt {
  bytes: Uint8Array;
  filename: string;
  /** What the receipt says, for the covering email. */
  number: string;
  amountText: string;
  dateText: string;
  methodText: string;
  balanceText?: string;
}

export async function renderReceipt(buyer: BuyerAccount, paymentKey: string): Promise<RenderedReceipt | null> {
  const payments = buyer.payments ?? [];
  const payment = payments.find((p) => p._key === paymentKey);
  if (!payment || !(payment.amount > 0)) return null;

  const numbers = await ensureReceiptNumbers(buyer._id, payments);
  const receiptNumber = numbers.get(paymentKey);
  if (!receiptNumber) return null;

  // Where the account stands once this payment is counted (oldest first).
  const ordered = payments.filter((p) => p._key).sort(byDateThenKey);
  let paidToDateUSD: number | null = 0;
  for (const p of ordered) {
    const usd = usdEquivalent(p);
    paidToDateUSD = paidToDateUSD !== null && usd !== null ? paidToDateUSD + usd : null;
    if (p._key === paymentKey) break;
  }

  const [unit, settings] = await Promise.all([
    client.fetch<Unit | null>(unitByNumberQuery, { unitNumber: buyer.unitNumber }).catch(() => null),
    client.fetch<SiteSettings | null>(siteSettingsQuery).catch(() => null),
  ]);

  const currency = payment.currency === "USD" ? "USD" : "GHS";
  const methodText = payment.method ? (METHOD_LABELS[payment.method] ?? formatMethod(payment.method)) : "Not recorded";
  const bytes = await buildReceiptPdf({
    receiptNumber,
    issuedOn: new Date().toISOString().slice(0, 10),
    buyerName: buyer.name,
    unitNumber: buyer.unitNumber,
    unitDescription: unit ? `${unit.bedroomType}, floor ${formatFloor(unit.floor)}` : undefined,
    payment: {
      amount: payment.amount,
      currency,
      exchangeRate: payment.exchangeRate,
      date: payment.date,
      methodLabel: methodText,
      note: payment.note,
    },
    usdEquivalent: usdEquivalent(payment),
    account:
      paidToDateUSD === null
        ? null
        : {
            contractPriceUSD: buyer.contractPriceUSD,
            paidToDateUSD,
            balanceUSD: Math.max(buyer.contractPriceUSD - paidToDateUSD, 0),
          },
    contact: {
      phone: settings?.contactPhone,
      email: settings?.contactEmail,
      address: settings?.officeAddress,
    },
  });

  const amountFigure = payment.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    bytes,
    filename: `Lexington-Receipt-${receiptNumber}.pdf`,
    number: receiptNumber,
    amountText: `${currency} ${amountFigure}`,
    dateText: longDate(payment.date),
    methodText,
    balanceText:
      paidToDateUSD === null
        ? undefined
        : `USD ${Math.max(buyer.contractPriceUSD - paidToDateUSD, 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  };
}

export function pdfResponse(file: { bytes: Uint8Array; filename: string }) {
  return new Response(new Blob([file.bytes as BlobPart], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      // A receipt is private to the buyer: never keep a copy in a shared cache.
      "Cache-Control": "private, no-store",
    },
  });
}
