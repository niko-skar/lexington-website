import type { TodoMe } from "@/lib/todo/shared";

// Reading the bank's own texts (Fidelity). Money in:
//   Credit Alert, Amount: GHS45000.0, Acct Num: 1060xxxxxxx13, Date: 28-10-2026 10:39:18,
//   Narration: ACCOUNT TO ACCOUNT TRANSFER, Current bal:GHS131,723.21.
// Money out, by card, to a mobile money wallet, and the bank's fee on that (same second, same balance):
//   Debit Alert, Amount: GHS2000.0, Acct Num: 1060xxxxxxx13, Date: 30-10-2026 08:16:06, Transaction Location:
//   YAZBECK PRO TRADERS LIMEast Legon 288,YAZBECK PRO TRADERS LIMEast Legon 288 Current bal:GHS24268.67.
//   Debit Alert, Amount: GHS3250.0, Acct Num: 1060xxxxxxx13, Date: 30-10-2026 08:19:33, Narration: Account to
//   Wallet, Cement, Current bal:GHS20998.67.
//   Debit Alert, Amount: GHS20.0, Acct Num: 1060xxxxxxx13, Date: 30-10-2026 08:19:33, Narration: Cement,
//   Current bal:GHS20998.67.

export interface BankText {
  direction: "credit" | "debit";
  amount: number;
  /** As the text shows it, lower case: "1060xxxxxxx13". */
  account: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, or "" when the text gives no time. */
  time: string;
  /** HH:MM:SS as the bank gave it (a debit and its fee share it to the second), or "". */
  stamp: string;
  narration: string;
  /** A card payment's shop and place ("Transaction Location"), once, or "". */
  location: string;
  balance: number | null;
}

/** Who a text's entry is "entered by" (the sheet shows it). */
export const BANK_ME: TodoMe = { kind: "admin", id: "office", name: "Bank text", sections: ["expenses"] };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number | string) => String(n).padStart(2, "0");
export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
export const tidyAccount = (s: string) => s.trim().toLowerCase().replace(/[*•]/g, "x");
export const accountEnd = (account: string) => account.replace(/^.*x/, "") || account.slice(-4);
/** "28 Oct, 10:39" */
export const whenText = (c: Pick<BankText, "date" | "time">) => `${Number(c.date.slice(8))} ${MONTHS[Number(c.date.slice(5, 7)) - 1]}${c.time ? `, ${c.time}` : ""}`;
const toNumber = (s: string) => Number(s.replace(/,/g, ""));

/** Money in or out in a bank text, or null when it isn't one or can't be read. */
export function readBankText(raw: string): BankText | null {
  const text = raw.replace(/\s+/g, " ").trim();
  const kind = /\b(credit|debit)\s*alert/i.exec(text);
  if (!kind) return null;
  const amount = /Amount\s*:\s*GH[S₵¢C]\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  const account = /Acc(?:oun)?t\.?\s*(?:Num(?:ber)?|No)\.?\s*:\s*([0-9xX*•]{6,24})/i.exec(text);
  const when = /Date\s*:\s*(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i.exec(text);
  if (!amount || !account || !when) return null;
  const value = Math.round(toNumber(amount[1]) * 100) / 100;
  const [d, m, y] = [Number(when[1]), Number(when[2]), Number(when[3])];
  const day = new Date(Date.UTC(y, m - 1, d));
  if (!(value > 0) || value > 100_000_000 || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) return null;
  // What follows "Narration:" or "Transaction Location:", up to the balance (a comma or just a line break before it).
  const until = String.raw`\s*,?\s*(?:Current|Avail\w*)\s*bal`;
  const narration = new RegExp(String.raw`Narration\s*:\s*(.*?)` + until, "i").exec(text)?.[1] ?? "";
  const place = new RegExp(String.raw`Transaction\s*Location\s*:\s*(.*?)` + until, "i").exec(text)?.[1] ?? "";
  // The bank writes the place twice ("SHOP Place,SHOP Place"): once is enough.
  const halves = place.split(",").map((s) => s.trim());
  const location = halves.length === 2 && halves[0] === halves[1] ? halves[0] : place.trim();
  const balance = /(?:Current|Avail\w*)\s*bal\w*\s*:?\s*GH[S₵¢C]\s*(-?[\d,]+(?:\.\d+)?)/i.exec(text);
  return {
    direction: kind[1].toLowerCase() === "debit" ? "debit" : "credit",
    amount: value,
    account: tidyAccount(account[1]),
    date: `${y}-${pad(m)}-${pad(d)}`,
    time: when[4] ? `${pad(when[4])}:${when[5]}` : "",
    stamp: when[4] ? `${pad(when[4])}:${when[5]}:${when[6] ?? "00"}` : "",
    narration: clip(narration.replace(/,\s*$/, "").trim(), 80),
    location: clip(location.replace(/,\s*$/, ""), 120),
    balance: balance ? toNumber(balance[1]) : null,
  };
}
