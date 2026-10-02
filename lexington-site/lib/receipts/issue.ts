import "server-only";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import type { Payment } from "@/lib/sanity/buyersTypes";

const COUNTER_ID = "receipt-counter";
const MAX_TRIES = 4;

export const formatReceiptNumber = (n: number) => `LEX-${String(n).padStart(4, "0")}`;

const receiptId = (buyerId: string, paymentKey: string) => `receipt-${buyerId}-${paymentKey}`;

export const byDateThenKey = (a: Payment, b: Payment) =>
  (a.date ?? "").localeCompare(b.date ?? "") || (a._key ?? "").localeCompare(b._key ?? "");

async function existingNumbers(buyerId: string) {
  const rows = await getBuyersClient().fetch<{ paymentKey: string; number: string }[]>(
    `*[_type == "receipt" && buyerId == $buyerId]{ paymentKey, number }`,
    { buyerId }
  );
  return new Map(rows.map((r) => [r.paymentKey, r.number]));
}

// Makes sure every payment on this buyer's account has its own receipt number
// and returns them (payment id -> number). A number is handed out once and
// never changes, even if the payment row is edited later.
//
// Numbers run LEX-0001, LEX-0002... across all buyers with no gaps: the shared
// counter and the new receipt records are written in one transaction, and if
// two people ask at the same moment one of them simply looks again.
export async function ensureReceiptNumbers(
  buyerId: string,
  payments: Payment[] | undefined
): Promise<Map<string, string>> {
  const client = getBuyersClient();

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const numbers = await existingNumbers(buyerId);
    const missing = (payments ?? [])
      .filter((p) => p._key && p.amount > 0 && !numbers.has(p._key))
      .sort(byDateThenKey);
    if (missing.length === 0) return numbers;

    await client.createIfNotExists({ _id: COUNTER_ID, _type: "receiptCounter", last: 0 });
    const counter = await client.fetch<{ _rev: string; last?: number } | null>(
      `*[_id == $id][0]{ _rev, last }`,
      { id: COUNTER_ID }
    );
    if (!counter) throw new Error("The receipt counter is missing.");

    const start = counter.last ?? 0;
    const issuedAt = new Date().toISOString();
    const assigned = missing.map((p, i) => ({ key: p._key as string, number: formatReceiptNumber(start + i + 1) }));

    try {
      let tx = client
        .transaction()
        .patch(COUNTER_ID, (p) => p.ifRevisionId(counter._rev).set({ last: start + assigned.length }));
      // `create` (not "create if missing") on purpose: if another request has
      // already issued one of these receipts, the whole transaction -- counter
      // included -- is refused, so no number is ever burnt or handed out twice.
      for (const a of assigned) {
        tx = tx.create({
          _id: receiptId(buyerId, a.key),
          _type: "receipt",
          number: a.number,
          buyerId,
          paymentKey: a.key,
          issuedAt,
        });
      }
      await tx.commit();
      return new Map([...numbers, ...assigned.map((a) => [a.key, a.number] as [string, string])]);
    } catch (err) {
      // Someone else numbered something a moment ago: look again.
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 409 || /already exists|revision/i.test(e.message ?? "")) continue;
      throw err;
    }
  }

  throw new Error("Couldn't number the receipts just now. Please try again.");
}
