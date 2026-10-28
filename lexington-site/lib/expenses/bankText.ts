import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { notifyOwner } from "@/lib/alerts/notify";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { BANK_TEXT_PREFIX, BANK_TEXT_SETTINGS_ID, EXPENSE_PREFIX } from "@/lib/site/ids";
import type { TodoMe } from "@/lib/todo/shared";
import { createExpense } from "./server";
import { money, todayISO, type BankNote } from "./shared";

// Money in from the bank's own text messages. Niko, 28 Oct 2026: "every Credit Alert text on my
// account goes straight in as money from Leo and on to QuickBooks. Alert me so I can change any
// that weren't from Leo." Leo pays the site's money into Niko's own account (the company has no
// bank account yet), and each transfer used to be typed by hand a few minutes after the bank's text.
//
// His iPhone passes on every text that says "Credit Alert" (a Shortcuts automation: Message
// contains "Credit Alert" -> Get Contents of URL, a POST to the private link below). One reads:
//   Credit Alert, Amount: GHS45000.0, Acct Num: 1060xxxxxxx13, Date: 28-10-2026 10:39:18,
//   Narration: ACCOUNT TO ACCOUNT TRANSFER, Current bal:GHS131,723.21.
// It never says who sent the money, so a credit on his account is booked as money in from Leo, a
// Site entry (every bank credit so far was Leo's): the Google Sheet and QuickBooks take it like a
// typed one, and his phone buzzes with a way to change it. Typed already (same day, same amount):
// the text only marks that entry as confirmed. A text counts once however often it arrives, and a
// credit on another account is never added, only an alert.

export type BankTextResult = "added" | "matched" | "already" | "other-account" | "not-credit" | "unreadable";

export interface CreditText {
  amount: number;
  /** As the text shows it, lower case: "1060xxxxxxx13". */
  account: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, or "" when the text gives no time. */
  time: string;
  narration: string;
  balance: number | null;
}

interface LastText {
  receivedAt: string;
  result: BankTextResult | "failed";
  ref: string | null;
  amount: number | null;
}

interface Settings {
  /** Bumped by "Make a new link": the old link stops working. */
  keyVersion?: number;
  /** The accounts whose credits are added (the one Leo pays into). */
  accounts?: string[];
  last?: LastText;
}

export interface BankTextStatus {
  link: string;
  accounts: string[];
  last: LastText | null;
}

/** Who a text's entry is "entered by" (the sheet shows it). */
const BANK_ME: TodoMe = { kind: "admin", id: "office", name: "Bank text", sections: ["expenses"] };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number | string) => String(n).padStart(2, "0");
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const tidyAccount = (s: string) => s.trim().toLowerCase().replace(/[*•]/g, "x");
const accountEnd = (account: string) => account.replace(/^.*x/, "") || account.slice(-4);
const whenText = (c: Pick<CreditText, "date" | "time">) =>
  `${Number(c.date.slice(8))} ${MONTHS[Number(c.date.slice(5, 7)) - 1]}${c.time ? `, ${c.time}` : ""}`;
const toNumber = (s: string) => Number(s.replace(/,/g, ""));

/* ---------- reading a text ---------- */

/** The credit in a bank text, or null when it isn't one or can't be read. */
export function readCreditText(raw: string): CreditText | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!/credit\s*alert/i.test(text)) return null;
  const amount = /Amount\s*:\s*GH[S₵¢C]\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  const account = /Acc(?:oun)?t\.?\s*(?:Num(?:ber)?|No)\.?\s*:\s*([0-9xX*•]{6,24})/i.exec(text);
  const when = /Date\s*:\s*(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?/i.exec(text);
  if (!amount || !account || !when) return null;
  const value = Math.round(toNumber(amount[1]) * 100) / 100;
  const [d, m, y] = [Number(when[1]), Number(when[2]), Number(when[3])];
  const day = new Date(Date.UTC(y, m - 1, d));
  if (!(value > 0) || value > 100_000_000 || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) return null;
  const narration = /Narration\s*:\s*(.*?)\s*,\s*(?:Current|Avail)/i.exec(text)?.[1] ?? "";
  const balance = /(?:Current|Avail\w*)\s*bal\w*\s*:?\s*GH[S₵¢C]\s*(-?[\d,]+(?:\.\d+)?)/i.exec(text);
  return {
    amount: value,
    account: tidyAccount(account[1]),
    date: `${y}-${pad(m)}-${pad(d)}`,
    time: when[4] ? `${pad(when[4])}:${when[5]}` : "",
    narration: clip(narration.trim(), 80),
    balance: balance ? toNumber(balance[1]) : null,
  };
}

/* ---------- the private link ---------- */

async function loadSettings(): Promise<Settings> {
  return (await getBuyersClient().fetch<Settings | null>(`*[_id == $id][0]{ keyVersion, accounts, last }`, { id: BANK_TEXT_SETTINGS_ID })) ?? {};
}

async function saveSettings(set: Partial<Settings>): Promise<void> {
  const client = getBuyersClient();
  await client.createIfNotExists({ _id: BANK_TEXT_SETTINGS_ID, _type: "bankTextSettings" });
  await client.patch(BANK_TEXT_SETTINGS_ID).set(set).commit();
}

/** The link's secret part: made from the website's own secret, so it is never stored anywhere. */
function linkKey(version: number): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET -- needed for the bank-text link.");
  return createHmac("sha256", secret).update(`lexington-bank-text:${BANK_TEXT_SETTINGS_ID}:v${version}`).digest("base64url").slice(0, 32);
}

export async function bankLinkOk(given: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(given)) return false;
  const want = linkKey((await loadSettings()).keyVersion ?? 1);
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

function status(s: Settings, origin: string): BankTextStatus {
  return { link: `${origin}/api/bank-text/${linkKey(s.keyVersion ?? 1)}`, accounts: s.accounts ?? [], last: s.last ?? null };
}

export async function bankTextStatus(origin: string): Promise<BankTextStatus> {
  return status(await loadSettings(), origin);
}

/** "Make a new link": the old one stops working at once. */
export async function newBankLink(origin: string): Promise<BankTextStatus> {
  const s = await loadSettings();
  const keyVersion = (s.keyVersion ?? 1) + 1;
  await saveSettings({ keyVersion });
  return status({ ...s, keyVersion }, origin);
}

/* ---------- a text arrives ---------- */

export interface BankTextOutcome {
  result: BankTextResult;
  ref: string | null;
  expenseId: string | null;
  /** A new entry: the Google Sheet and QuickBooks still have to take it. */
  added: boolean;
}

const outcome = (result: BankTextResult, ref: string | null = null, expenseId: string | null = null, added = false): BankTextOutcome => ({ result, ref, expenseId, added });

function inWindow(date: string): boolean {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 45);
  const to = new Date();
  to.setUTCDate(to.getUTCDate() + 1);
  return date >= todayISO(from) && date <= todayISO(to);
}

/** A money in typed already for the same day and amount, not yet tied to a text (Leo's first). */
async function typedTwin(c: CreditText): Promise<{ id: string; ref: string | null } | null> {
  const rows = await getBuyersClient().fetch<Array<{ id: string; ref: string | null; supplier: string | null }>>(
    `*[_type == "siteExpense" && string::startsWith(_id, $prefix) && kind == "inflow" && date == $date && amount > $low && amount < $high && !defined(bank)] | order(createdAt asc){ "id": _id, ref, supplier }`,
    { prefix: EXPENSE_PREFIX, date: c.date, low: c.amount - 0.005, high: c.amount + 0.005 }
  );
  return rows.find((r) => /\bleo\b/i.test(r.supplier ?? "")) ?? rows[0] ?? null;
}

/**
 * One text from the bank, as the iPhone passed it on. A dry run says what would happen and
 * changes nothing (for checking the link).
 */
export async function receiveBankText(raw: string, { dryRun = false } = {}): Promise<BankTextOutcome> {
  const text = raw.slice(0, 2000);
  const receivedAt = new Date().toISOString();
  const remember = async (last: Omit<LastText, "receivedAt">) => {
    if (!dryRun) await saveSettings({ last: { receivedAt, ...last } }).catch(() => {});
  };

  // Only credit texts are meant to come (the automation picks them); anything else is dropped unread.
  if (!/credit\s*alert/i.test(text)) {
    await remember({ result: "not-credit", ref: null, amount: null });
    return outcome("not-credit");
  }
  const c = readCreditText(text);
  if (!c || !inWindow(c.date)) {
    if (!dryRun) {
      await remember({ result: "unreadable", ref: null, amount: c?.amount ?? null });
      await notifyOwner({
        kind: "bank",
        title: "A bank text couldn't be read",
        lines: [
          c ? `Its date (${whenText(c)} ${c.date.slice(0, 4)}) is too far off, so nothing was added.` : "Your iPhone passed on a bank text the app couldn't read, so nothing was added.",
          "If it was money in, add it by hand:",
          `• ${clip(text.replace(/\s+/g, " ").trim(), 300)}`,
        ],
        links: [{ label: "Open the expenses", url: "/todo/expenses" }],
        urgent: true,
      });
    }
    return outcome("unreadable");
  }

  const settings = await loadSettings();
  const accounts = (settings.accounts ?? []).map(tidyAccount);
  // No account set yet: the first text's account becomes the one (the live site has Leo's set).
  const ours = accounts.length === 0 || accounts.includes(c.account);
  const textId = BANK_TEXT_PREFIX + createHash("sha256").update([c.account, c.date, c.time, c.amount, c.balance ?? ""].join("|")).digest("hex").slice(0, 12);
  const client = getBuyersClient();

  if (dryRun) {
    if (await client.fetch<boolean>(`defined(*[_id == $id][0]._id)`, { id: textId })) return outcome("already");
    if (!ours) return outcome("other-account");
    const twin = await typedTwin(c);
    return twin ? outcome("matched", twin.ref, twin.id) : outcome("added");
  }

  // Claim the text first: the same text sent twice (or two at once) is counted once.
  try {
    await client.create({ _id: textId, _type: "bankText", receivedAt, ...c, text: clip(text, 600), result: "working" });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 409) return outcome("already");
    throw error;
  }

  try {
    if (!ours) {
      await client.patch(textId).set({ result: "other-account" }).commit();
      await remember({ result: "other-account", ref: null, amount: c.amount });
      await notifyOwner({
        kind: "bank",
        title: `${money(c.amount)} came into another account`,
        lines: [
          `Your bank's text of ${whenText(c)} is for the account ending ${accountEnd(c.account)}, not the one Leo pays into, so nothing was added.`,
          "If it was money for the site, add it by hand.",
        ],
        links: [{ label: "Open the expenses", url: "/todo/expenses" }],
      });
      return outcome("other-account");
    }
    if (accounts.length === 0) await saveSettings({ accounts: [c.account] });

    const note: BankNote = { at: `${c.date}${c.time ? ` ${c.time}` : ""}`, account: c.account, balance: c.balance, matched: false };
    const twin = await typedTwin(c);
    if (twin) {
      // Typed already: the text confirms it, and nothing in the books changes.
      await client.patch(twin.id).set({ bank: { ...note, matched: true } }).commit();
      await client.patch(textId).set({ result: "matched", expenseId: twin.id }).commit();
      await remember({ result: "matched", ref: twin.ref, amount: c.amount });
      return outcome("matched", twin.ref, twin.id);
    }

    const said = c.narration ? `: ${c.narration.charAt(0)}${c.narration.slice(1).toLowerCase()}` : "";
    const expense = await createExpense(
      BANK_ME,
      {
        kind: "inflow",
        forWho: "Site",
        date: c.date,
        amount: c.amount,
        method: "Bank transfer",
        supplier: "Leo",
        description: `From the bank's text${c.time ? ` (${c.time})` : ""}${said}`,
      },
      { bank: note }
    );
    await client.patch(textId).set({ result: "added", expenseId: expense.id }).commit();
    await remember({ result: "added", ref: expense.ref, amount: c.amount });
    const open = `/todo/expenses?open=${expense.id}`;
    await notifyOwner({
      kind: "bank",
      title: `${money(c.amount)} from Leo added`,
      lines: [
        `From your bank's text of ${whenText(c)} (account ending ${accountEnd(c.account)}). ${expense.ref ?? "It"} goes to QuickBooks like the ones you type.`,
        "Not from Leo? Tap to open it, then change who it's from or delete it.",
      ],
      links: [{ label: `Open ${expense.ref ?? "the entry"}`, url: open }],
      urgent: true,
      open,
      tag: `bank-${expense.id}`,
    });
    return outcome("added", expense.ref, expense.id, true);
  } catch (error) {
    // Let it come again (a resend counts), and tell him it's not in.
    await client.delete(textId).catch(() => {});
    await remember({ result: "failed", ref: null, amount: c.amount });
    await notifyOwner({
      kind: "bank",
      title: "A bank text couldn't be added",
      lines: [`${money(c.amount)} on ${whenText(c)}: something went wrong on our side, so it isn't in the expenses. Add it by hand.`],
      links: [{ label: "Open the expenses", url: "/todo/expenses" }],
      urgent: true,
    });
    throw error;
  }
}
