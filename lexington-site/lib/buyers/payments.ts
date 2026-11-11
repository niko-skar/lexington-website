import "server-only";
import { randomBytes } from "node:crypto";

import { notifyOwner } from "@/lib/alerts/notify";
import { usdEquivalent } from "@/lib/currency";
import { markReceiptEmailed, sendReceiptEmail } from "@/lib/receipts/email";
import { byDateThenKey, ensureReceiptNumbers } from "@/lib/receipts/issue";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import type { BuyerAccount, Payment } from "@/lib/sanity/buyersTypes";
import { cleanText, TodoError } from "@/lib/todo/server";
import { BUYER_METHODS, isEmail, MAX_NOTE, namesBuyer, paymentText, type BuyerPaymentRow, type BuyerRow, type BuyersData } from "./shared";

// Buyer payments logged in the site app (lib/buyers/shared.ts says what and why). The payment is written onto the
// buyer's account exactly as one typed in Studio (so the portal, the receipts and the admin pages all see it the
// same way), numbered at once, and its receipt emailed there and then; should the email fail, the five-minute
// receipt run (lib/receipts/email.ts) tries again.

/** Buyers only (never an admin or a site login), published accounts only (not a Studio draft). */
const BUYERS = `*[_type == "buyerAccount" && coalesce(role, "buyer") == "buyer" && !(_id in path("drafts.**"))]`;
const receiptDocId = (buyerId: string, key: string) => `receipt-${buyerId}-${key}`;

type AccountRow = { id: string; name: string | null; email: string; unit: string | null; priceUSD: number | null; listPriceUSD: number | null; payments: Payment[] | null };
type ReceiptRow = { buyerId: string; paymentKey: string; number: string; emailedAt: string | null; emailedTo: string | null; emailError: string | null; skipEmail: boolean | null };

export async function listBuyers(): Promise<BuyersData> {
  const client = getBuyersClient();
  const accounts = await client.fetch<AccountRow[]>(
    `${BUYERS} | order(unitNumber asc){ "id": _id, name, email, "unit": unitNumber, "priceUSD": contractPriceUSD, listPriceUSD, payments }`
  );
  const receipts = await client.fetch<ReceiptRow[]>(`*[_type == "receipt" && buyerId in $ids]{ buyerId, paymentKey, number, emailedAt, emailedTo, emailError, skipEmail }`, {
    ids: accounts.map((a) => a.id),
  });
  const receiptOf = new Map(receipts.map((r) => [`${r.buyerId}|${r.paymentKey}`, r]));
  let lastRate: { date: string; rate: number } | null = null;

  const buyers: BuyerRow[] = accounts.map((a) => {
    const payments = (a.payments ?? []).filter((p) => p && p._key && p.amount > 0);
    let paidUSD = 0;
    let missingRate = 0;
    const rows: BuyerPaymentRow[] = [...payments].sort(byDateThenKey).reverse().map((p) => {
      const inUsd = usdEquivalent(p);
      if (inUsd === null) missingRate++;
      else paidUSD += inUsd;
      if (p.currency === "GHS" && p.exchangeRate && p.date && (!lastRate || p.date > lastRate.date)) lastRate = { date: p.date, rate: p.exchangeRate };
      const r = receiptOf.get(`${a.id}|${p._key}`);
      return {
        key: p._key as string,
        amount: p.amount,
        currency: p.currency === "USD" ? "USD" : "GHS",
        exchangeRate: p.exchangeRate ?? null,
        date: p.date ?? null,
        method: p.method ?? null,
        note: p.note ?? null,
        usd: inUsd === null ? null : Math.round(inUsd * 100) / 100,
        receipt: r?.number ?? null,
        emailedAt: r?.emailedAt ?? null,
        emailedTo: r?.emailedTo ?? null,
        emailError: r?.emailError ?? null,
        noEmail: r?.skipEmail === true,
      };
    });
    const priceUSD = a.priceUSD ?? 0;
    return {
      id: a.id,
      name: a.name?.trim() || a.email,
      email: a.email,
      unit: a.unit ?? null,
      priceUSD,
      listPriceUSD: a.listPriceUSD ?? null,
      paidUSD: Math.round(paidUSD * 100) / 100,
      missingRate,
      balanceUSD: Math.max(Math.round((priceUSD - paidUSD) * 100) / 100, 0),
      payments: rows,
    };
  });
  return { buyers, lastRate: (lastRate as { rate: number } | null)?.rate ?? null };
}

const number = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN);

/** A payment from a buyer: onto their account, numbered, its receipt emailed to them (kept for the office to send when they have no email). */
export async function logBuyerPayment(body: Record<string, unknown>): Promise<{
  data: BuyersData;
  receipt: string | null;
  emailed: { ok: true; to: string } | { ok: false; error: string; noEmail?: boolean };
}> {
  const client = getBuyersClient();
  const buyer = await client.fetch<BuyerAccount | null>(`${BUYERS}[_id == $id][0]`, { id: typeof body.buyerId === "string" ? body.buyerId : "" });
  if (!buyer) throw new TodoError(404, "That buyer isn't there any more.");

  const amount = Math.round(number(body.amount) * 100) / 100;
  if (!(amount > 0) || amount > 100_000_000) throw new TodoError(400, "Type the amount paid.");
  if (body.currency !== "USD" && body.currency !== "GHS") throw new TodoError(400, "Pick US$ or GH₵.");
  const currency = body.currency;
  let exchangeRate: number | undefined;
  if (currency === "GHS") {
    exchangeRate = Math.round(number(body.exchangeRate) * 10_000) / 10_000;
    if (!(exchangeRate > 1 && exchangeRate < 1000)) throw new TodoError(400, "Type the rate used: cedis per US dollar that day.");
  }
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && !Number.isNaN(Date.parse(`${body.date}T00:00:00Z`)) ? body.date : "";
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (!date || date > tomorrow || date < "2024-01-01") throw new TodoError(400, "Pick the day it was paid.");
  const method = BUYER_METHODS.find((m) => m.value === body.method)?.value;
  if (!method) throw new TodoError(400, "Pick how it was paid.");
  const note = cleanText(body.note, MAX_NOTE, "note");

  // Onto the account, as Studio writes a payment.
  const key = randomBytes(6).toString("hex");
  await client
    .patch(buyer._id)
    .setIfMissing({ payments: [] })
    .append("payments", [{ _key: key, _type: "payment", amount, currency, ...(exchangeRate ? { exchangeRate } : {}), date, method, ...(note ? { note } : {}) }])
    .commit();

  // Its receipt number now, and the email straight away (the scheduled run would wait ten minutes for a Studio typo).
  const fresh = await client.fetch<BuyerAccount>(`*[_id == $id][0]`, { id: buyer._id });
  const numbers = await ensureReceiptNumbers(buyer._id, fresh.payments);
  const receipt = numbers.get(key) ?? null;
  const docId = receiptDocId(buyer._id, key);
  // A buyer with a username and no email: the receipt is made and kept, never emailed; the office sends it.
  if (!isEmail(fresh.email)) {
    await client.patch(docId).set({ skipEmail: true }).commit().catch(() => {});
    await notifyOwner({
      kind: "receipt",
      title: `Receipt ${receipt ?? ""} for ${fresh.name} is ready to send`.replace("  ", " "),
      lines: [`${paymentText({ amount, currency })} · unit ${fresh.unitNumber ?? "—"} · no email on this account: open it and send it yourself.`],
      links: [
        { label: "Open the receipt", url: `/admin/receipts/${fresh._id}/${key}` },
        { label: "Open their page", url: `/admin/${fresh._id}` },
      ],
    });
    return { data: await listBuyers(), receipt, emailed: { ok: false, noEmail: true, error: "No email on this account." } };
  }
  const claimed = await client
    .fetch<{ _rev: string } | null>(`*[_id == $id][0]{ _rev }`, { id: docId })
    .then((r) => (r ? client.patch(docId).ifRevisionId(r._rev).set({ emailClaimedAt: new Date().toISOString() }).commit() : null))
    .catch(() => null);
  let emailed: { ok: true; to: string } | { ok: false; error: string; noEmail?: boolean };
  if (!claimed) emailed = { ok: false, error: "The receipt is being sent already." };
  else {
    const result = await sendReceiptEmail(fresh, key);
    if (result.ok) {
      await markReceiptEmailed(buyer._id, key, result.to);
      emailed = { ok: true, to: result.to };
      await notifyOwner({
        kind: "receipt",
        title: `Receipt ${result.number} emailed to ${fresh.name}`,
        lines: [`${paymentText({ amount, currency })} · unit ${fresh.unitNumber ?? "—"} · sent to ${result.to}.`],
        links: [{ label: "Open their page", url: `/admin/${fresh._id}` }],
      });
    } else {
      emailed = { ok: false, error: result.error };
      // The receipt run tries again in a few minutes.
      await client
        .patch(docId)
        .setIfMissing({ emailAttempts: 0 })
        .inc({ emailAttempts: 1 })
        .set({ emailError: result.error.slice(0, 200) })
        .unset(["emailClaimedAt"])
        .commit()
        .catch(() => {});
    }
  }
  return { data: await listBuyers(), receipt, emailed };
}

/**
 * A buyer's payment in cedis for this day and amount, not yet tied to a bank text: the bank's credit text for it
 * is that payment, not money from Leo (lib/expenses/bankText.ts).
 */
export async function buyerPaymentFor(date: string, amount: number): Promise<{ buyerId: string; name: string; key: string; receipt: string | null } | null> {
  const client = getBuyersClient();
  const rows = await client.fetch<Array<{ id: string; name: string | null; email: string; keys: string[] | null }>>(
    `${BUYERS}[count(payments[currency == "GHS" && date == $date && amount > $low && amount < $high]) > 0]{ "id": _id, name, email, "keys": payments[currency == "GHS" && date == $date && amount > $low && amount < $high]._key }`,
    { date, low: amount - 0.005, high: amount + 0.005 }
  );
  for (const row of rows) {
    for (const key of row.keys ?? []) {
      const taken = await client.fetch<boolean>(`defined(*[_type == "bankText" && buyerPaymentKey == $key][0]._id)`, { key });
      if (taken) continue;
      const receipt = await client.fetch<string | null>(`*[_id == $id][0].number`, { id: receiptDocId(row.id, key) });
      return { buyerId: row.id, name: row.name?.trim() || row.email, key, receipt };
    }
  }
  return null;
}

/**
 * The buyer a bank credit's narration names (namesBuyer in lib/buyers/shared.ts), among the accounts with a contract
 * price. Two buyers named: it can't tell which, so neither.
 */
export async function buyerNamedIn(narration: string | null | undefined): Promise<{ buyerId: string; name: string } | null> {
  if (!narration?.trim()) return null;
  const rows = await getBuyersClient().fetch<Array<{ id: string; name: string }>>(`${BUYERS}[contractPriceUSD > 0 && defined(name)]{ "id": _id, name }`);
  const hits = rows.filter((r) => namesBuyer(narration, r.name));
  return hits.length === 1 ? { buyerId: hits[0].id, name: hits[0].name.trim() } : null;
}
