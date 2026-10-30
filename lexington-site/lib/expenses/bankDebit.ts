import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";

import { notifyOwner } from "@/lib/alerts/notify";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BANK_TEXT_PREFIX, BANK_TEXT_SETTINGS_ID, EXPENSE_PREFIX } from "@/lib/site/ids";
import { TodoError } from "@/lib/todo/server";
import { accountEnd, BANK_ME, clip, whenText, type BankText } from "./bankParse";
import { createExpense } from "./server";
import { debitWords, money, shopOf, type BankDebit, type BankNote } from "./shared";

// Money out from the bank's own texts. Niko, 30 Oct 2026: "each fidelity alert I receive goes into the app as a
// pending expense that I can add additional information for and / or photos of receipts. then bank transfer or
// momo fees are automatically filed in quickbooks."
//
// His iPhone passes on each "Debit Alert" text like the credit ones (lib/expenses/bankText.ts). A debit waits in
// the expenses under "From the bank" until he says what it was (who, what for, the receipt): then it is an
// ordinary expense and goes to the Google Sheet and QuickBooks. One he typed already (same day, same amount) is
// only confirmed. The bank's fee on a payment comes as its own text, to the second with the same balance (GHS
// 3,250 to a wallet and GHS 20 at 08:19:33): on the account Leo pays into, a fee is filed at once as a Site
// expense to Fidelity Bank, so it reaches QuickBooks with nobody touching it. A text counts once.

export type DebitResult = "pending" | "fee" | "matched" | "already";

/** Whether the two texts are one payment and its fee: the same account, to the second, the same balance after. */
const SIBLINGS = `*[_type == "bankText" && string::startsWith(_id, $prefix) && direction == "debit" && account == $account && date == $date && stamp == $stamp && balance == $balance && _id != $id]{ _id, amount, result, narration, location, time, date }`;
const FEE_WORDS = /\b(fee|fees|charge|charges|commission|levy)\b/i;
/** Texts that come together arrive within a moment of each other: wait this long before deciding a text is alone. */
const SETTLE_MS = 3_000;
/** A payment's phone alert waits for its fee's text, so one alert says both. */
const ALERT_AFTER_MS = 12_000;

type Sibling = { _id: string; amount: number; result: string; narration: string; location?: string; time: string; date: string };

const noteOf = (c: Pick<BankText, "date" | "time" | "account" | "balance">, matched: boolean): BankNote => ({
  at: `${c.date}${c.time ? ` ${c.time}` : ""}`,
  account: c.account,
  balance: c.balance,
  matched,
});

/** What a fee's entry says it was for: "Bank fee: to a MoMo wallet (Cement), 30 Oct, 08:19". */
const feeWords = (main: Pick<Sibling, "narration" | "location"> | null, c: Pick<BankText, "date" | "time">) =>
  clip(`Bank fee${main ? `: ${debitWords({ narration: main.narration, where: main.location ?? "" })}` : ""}, ${whenText(c)}`, 120);

/** The fee as its own Site expense (Service, to Fidelity Bank, paid from the account), straight to the books. */
async function fileFee(textId: string, c: BankText, main: Sibling | null): Promise<{ id: string; ref: string | null }> {
  const expense = await createExpense(
    BANK_ME,
    {
      kind: "expense",
      forWho: "Site",
      date: c.date,
      amount: c.amount,
      method: "Bank transfer",
      category: "Service",
      floor: "Whole building",
      supplier: "Fidelity Bank",
      description: feeWords(main, c),
    },
    { bank: noteOf(c, false) }
  );
  await getBuyersClient()
    .patch(textId)
    .set({ result: "fee", expenseId: expense.id, ...(main ? { feeOf: main._id } : {}) })
    .commit();
  return { id: expense.id, ref: expense.ref };
}

/** An expense typed already for the same day and amount, not yet tied to a bank text. */
async function typedTwin(c: BankText): Promise<{ id: string; ref: string | null } | null> {
  return getBuyersClient().fetch<{ id: string; ref: string | null } | null>(
    `*[_type == "siteExpense" && string::startsWith(_id, $prefix) && coalesce(kind, "expense") == "expense" && date == $date && amount > $low && amount < $high && !defined(bank)] | order(createdAt asc)[0]{ "id": _id, ref }`,
    { prefix: EXPENSE_PREFIX, date: c.date, low: c.amount - 0.005, high: c.amount + 0.005 }
  );
}

export interface DebitOutcome {
  result: DebitResult;
  ref: string | null;
  expenseId: string | null;
  /** New entries (fees) the Google Sheet and QuickBooks still have to take. */
  filed: string[];
}

/**
 * One "Debit Alert" text. `siteAccount`: it's on the account Leo pays into (only there are fees filed by
 * themselves; another account's debits all wait for Niko). A dry run changes nothing.
 */
export async function receiveDebit(c: BankText, text: string, { siteAccount, dryRun = false }: { siteAccount: boolean; dryRun?: boolean }): Promise<DebitOutcome> {
  const client = getBuyersClient();
  const textId = BANK_TEXT_PREFIX + createHash("sha256").update(["debit", c.account, c.date, c.stamp, c.amount, c.balance ?? ""].join("|")).digest("hex").slice(0, 12);
  const out = (result: DebitResult, ref: string | null = null, expenseId: string | null = null, filed: string[] = []): DebitOutcome => ({ result, ref, expenseId, filed });
  if (dryRun) return (await client.fetch<boolean>(`defined(*[_id == $id][0]._id)`, { id: textId })) ? out("already") : out("pending");

  // Claim the text first: the same text sent twice (or two at once) is counted once.
  try {
    await client.create({ _id: textId, _type: "bankText", receivedAt: new Date().toISOString(), ...c, text: clip(text, 600), result: "working" });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 409) return out("already");
    throw error;
  }

  try {
    // A payment and its fee are two texts at the same moment: give the other one the time to arrive.
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const siblings = c.stamp && c.balance !== null ? await client.fetch<Sibling[]>(SIBLINGS, { prefix: BANK_TEXT_PREFIX, account: c.account, date: c.date, stamp: c.stamp, balance: c.balance, id: textId }) : [];
    // The biggest one is the payment, the others its fees (two the same: the first id is the payment).
    const main = siblings.filter((s) => s.amount > c.amount || (s.amount === c.amount && s._id < textId)).sort((a, b) => b.amount - a.amount)[0] ?? null;
    const isFee = !!main || FEE_WORDS.test(c.narration);

    if (isFee && siteAccount) {
      const fee = await fileFee(textId, c, main);
      return out("fee", fee.ref, fee.id, [fee.id]);
    }

    const twin = await typedTwin(c);
    if (twin) {
      // Typed already: the text confirms it, and nothing in the books changes.
      await client.patch(twin.id).set({ bank: noteOf(c, true) }).commit();
      await client.patch(textId).set({ result: "matched", expenseId: twin.id }).commit();
      return out("matched", twin.ref, twin.id);
    }
    await client.patch(textId).set({ result: "pending" }).commit();

    // Its fee's text came first and is waiting as if it were a payment of its own: it's a fee after all.
    const filed: string[] = [];
    if (siteAccount) {
      for (const s of siblings.filter((x) => x.amount < c.amount && x.result === "pending")) {
        const fee = await fileFee(s._id, { ...c, amount: s.amount, narration: s.narration }, { _id: textId, amount: c.amount, result: "pending", narration: c.narration, location: c.location, time: c.time, date: c.date });
        filed.push(fee.id);
      }
    }
    after(() => tellAboutDebit(textId, siteAccount));
    return out("pending", null, null, filed);
  } catch (error) {
    // Let it come again (a resend counts).
    await client.delete(textId).catch(() => {});
    throw error;
  }
}

/** The phone alert for a payment waiting in the app (after its fee had time to come, so one alert says both). */
async function tellAboutDebit(id: string, siteAccount: boolean): Promise<void> {
  try {
    await new Promise((r) => setTimeout(r, ALERT_AFTER_MS));
    const [d] = await loadDebits([id]);
    if (!d) return;
    const open = `/todo/expenses?debit=${id}`;
    const title = d.where ? `${money(d.amount)} at ${shopOf(d.where).shop}` : `${money(d.amount)} paid out: ${debitWords(d)}`;
    await notifyOwner({
      kind: "bank",
      title,
      lines: [
        `From your bank's text of ${whenText(d)}${siteAccount ? "" : ` (account ending ${accountEnd(d.account)})`}.`,
        ...d.fees.map((f) => `The bank's fee of ${money(f.amount)} is filed by itself${f.ref ? ` as ${f.ref}` : ""}.`),
        "Tap to say what it was for and add the receipt; it then goes to QuickBooks.",
      ],
      links: [{ label: "Complete it", url: open }],
      // The site account's payments buzz the phone; another account's wait quietly in Alerts.
      urgent: siteAccount,
      open,
      tag: `debit-${id}`,
    });
  } catch (error) {
    console.error("[bank debit] alert failed:", error instanceof Error ? error.message : error);
  }
}

/* ---------- the list in the app ---------- */

type DebitRow = Omit<BankDebit, "siteAccount" | "fees" | "where"> & { location: string | null };

/** Debits waiting in the app (or the ones asked for, while still waiting), newest first, with their fees. */
async function loadDebits(ids: string[] | null): Promise<BankDebit[]> {
  const client = getBuyersClient();
  const rows = await client.fetch<DebitRow[]>(
    `*[_type == "bankText" && string::startsWith(_id, $prefix) && direction == "debit" && result == "pending" && (!$some || _id in $ids)] | order(date desc, stamp desc)[0...300]{ "id": _id, amount, date, time, account, narration, location, balance, receivedAt }`,
    { prefix: BANK_TEXT_PREFIX, some: ids !== null, ids: ids ?? [] }
  );
  if (!rows.length) return [];
  const [fees, settings] = await Promise.all([
    client.fetch<Array<{ feeOf: string; amount: number; ref: string | null }>>(`*[_type == "bankText" && feeOf in $ids]{ feeOf, amount, "ref": *[_id == ^.expenseId][0].ref }`, { ids: rows.map((r) => r.id) }),
    client.fetch<{ accounts?: string[] } | null>(`*[_id == $id][0]{ accounts }`, { id: BANK_TEXT_SETTINGS_ID }),
  ]);
  const accounts = settings?.accounts ?? [];
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    date: r.date,
    time: r.time ?? "",
    account: r.account,
    siteAccount: accounts.length === 0 || accounts.includes(r.account),
    narration: r.narration ?? "",
    where: r.location ?? "",
    balance: r.balance ?? null,
    receivedAt: r.receivedAt,
    fees: fees.filter((f) => f.feeOf === r.id).map((f) => ({ amount: f.amount, ref: f.ref })),
  }));
}

export const listPendingDebits = () => loadDebits(null);

const ID_RE = new RegExp(`^${BANK_TEXT_PREFIX}[a-f0-9]{12}$`);

/** A waiting debit, as the bank's note for the expense made from it (null when it isn't waiting any more). */
export async function pendingDebit(id: unknown): Promise<{ id: string; note: BankNote; rev: string } | null> {
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  const d = await getBuyersClient().fetch<(BankText & { _rev: string }) | null>(`*[_id == $id && _type == "bankText" && direction == "debit" && result == "pending"][0]`, { id });
  return d ? { id, note: noteOf(d, false), rev: d._rev } : null;
}

/** A waiting debit for the same day and amount as an expense being typed (so it isn't left waiting). */
export async function debitFor(date: unknown, amount: unknown): Promise<{ id: string; note: BankNote; rev: string } | null> {
  const value = typeof amount === "number" ? amount : Number(String(amount ?? "").replace(/,/g, ""));
  if (typeof date !== "string" || !(value > 0)) return null;
  const d = await getBuyersClient().fetch<(BankText & { _id: string; _rev: string }) | null>(
    `*[_type == "bankText" && string::startsWith(_id, $prefix) && direction == "debit" && result == "pending" && date == $date && amount > $low && amount < $high] | order(stamp asc)[0]`,
    { prefix: BANK_TEXT_PREFIX, date, low: value - 0.005, high: value + 0.005 }
  );
  return d ? { id: d._id, note: noteOf(d, true), rev: d._rev } : null;
}

/** The debit is an expense now (made from it, or typed and matched to it). */
export async function settleDebit(debit: { id: string; rev: string }, expenseId: string, how: "completed" | "matched"): Promise<void> {
  await getBuyersClient().patch(debit.id).ifRevisionId(debit.rev).set({ result: how, expenseId }).commit();
}

/** "Not an expense" (a transfer between his own accounts, cash taken out), and back again. */
export async function dismissDebit(id: unknown, back: boolean): Promise<void> {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new TodoError(404, "That bank text isn't there any more.");
  const client = getBuyersClient();
  const d = await client.fetch<{ result: string; _rev: string } | null>(`*[_id == $id && _type == "bankText" && direction == "debit"][0]{ result, _rev }`, { id });
  if (!d) throw new TodoError(404, "That bank text isn't there any more.");
  if (back ? d.result !== "dismissed" : d.result !== "pending") throw new TodoError(409, back ? "That one is back already." : "That one isn't waiting any more.");
  await client
    .patch(id)
    .ifRevisionId(d._rev)
    .set({ result: back ? "pending" : "dismissed", ...(back ? {} : { dismissedAt: new Date().toISOString() }) })
    .commit();
}
