// Buyer payments in the site app (/todo/buyers), the office only. Niko, 30 Oct 2026: "in this system i should also
// be able to log buyer payments that automatically makes a receipt and emails it to them and updates their buyer
// portal at the same time". A payment goes onto the buyer's account (what their portal shows), gets its receipt
// number (LEX-0001...), and the receipt PDF is emailed to them there and then (lib/receipts). Contract prices
// and balances are in US dollars; a payment in cedis carries the rate used that day.

export const BUYER_METHODS = [
  { value: "bank-transfer", label: "Bank transfer" },
  { value: "momo", label: "MoMo" },
  { value: "cash", label: "Cash" },
] as const;
export type BuyerMethod = (typeof BUYER_METHODS)[number]["value"];

export const MAX_NOTE = 140;

// Money in from a buyer is written "Dr. Michael E. Gyasi (buyer)": the books hold it in Customer Deposits, never as
// Leo's money (Niko, 4 Nov 2026; lib/quickbooks/feed.ts).
export const BUYER_MARK = "(buyer)";

const TITLES = new Set(["DR", "MR", "MRS", "MS", "MISS", "PROF", "REV", "HON", "AND"]);

/**
 * Whether a bank text's narration ("INSTANT TRANSFER IFO, Property part payment BY MICHAEL EKUOBA-GYASI") names this
 * buyer: two of the names on their account as whole words (titles and initials aside), or the only one there is.
 */
export function namesBuyer(narration: string, buyerName: string): boolean {
  const said = ` ${narration.toUpperCase().replace(/[^A-Z]+/g, " ")} `;
  const names = [...new Set(buyerName.toUpperCase().split(/[^A-Z]+/).filter((w) => w.length > 2 && !TITLES.has(w)))];
  if (names.length === 0) return false;
  return names.filter((w) => said.includes(` ${w} `)).length >= Math.min(2, names.length);
}

export interface BuyerPaymentRow {
  key: string;
  amount: number;
  currency: "GHS" | "USD";
  /** GH₵ per US$ that day (cedi payments). */
  exchangeRate: number | null;
  date: string | null;
  method: string | null;
  note: string | null;
  /** What it counts for in US dollars (null: a cedi payment without its rate). */
  usd: number | null;
  /** LEX-0001 once numbered. */
  receipt: string | null;
  emailedAt: string | null;
  emailedTo: string | null;
  emailError: string | null;
  /** A receipt from before the emails went out by themselves (never sent, on purpose). */
  noEmail: boolean;
}

export interface BuyerRow {
  id: string;
  name: string;
  email: string;
  unit: string | null;
  priceUSD: number;
  listPriceUSD: number | null;
  paidUSD: number;
  /** Cedi payments without a rate (they can't be counted in dollars). */
  missingRate: number;
  balanceUSD: number;
  /** Newest first. */
  payments: BuyerPaymentRow[];
}

export interface BuyersData {
  buyers: BuyerRow[];
  /** The cedi rate used last (to start the next cedi payment with). */
  lastRate: number | null;
}

/** "US$ 130,900", or "US$ 1,438.60" when there are cents. */
export const usd = (n: number) => {
  const cents = Math.abs(Math.round(n * 100)) % 100 !== 0;
  return `US$ ${n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
};
export const paymentText = (p: Pick<BuyerPaymentRow, "amount" | "currency">) =>
  `${p.currency === "USD" ? "US$" : "GH₵"} ${p.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
