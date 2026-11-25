/**
 * The price calculator (Niko, 25 Nov 2026: "build a price calculator that would show the discounts, and monthly or
 * quarterly payments, they can click mortgage financing. and estimated monthly building maintenance fee for that unit").
 * Pure arithmetic, so it can be tested, and the same rules as the rest of the site:
 *  - the discount is the offer running today, off the price shown (VAT included), to the whole dollar, as the chat
 *    assistant and the lead replies quote it (lib/agents/factsCore.ts discounted());
 *  - the $10,000 reservation is the standard deposit (Niko, 24 Nov 2026), and the rest is paid in full or in equal
 *    payments over the plan (up to 12 months);
 *  - mortgage financing: the price is higher by the percentage the Invest page's mortgage note gives (5% on 25 Nov
 *    2026), with no discount, the same deposit, and the rest through the buyer's mortgage;
 *  - the building management fee: about US$1–2 per sqm a month (his figure in the sale agreement terms, 2 Oct 2026).
 */

export type PayMethod = "full" | "plan" | "mortgage";

/** The plan lengths offered (months), and how often a payment falls due. */
export const PLAN_MONTHS = [3, 6, 9, 12] as const;
export type PlanEvery = "month" | "quarter";

/** About US$1–2 per sqm a month (the guide figure on the Invest page). */
export const FEE_PER_SQM = { low: 1, high: 2 } as const;

export interface PayInput {
  /** The price shown for the home and finish, VAT included. */
  listPrice: number;
  method: PayMethod;
  /** Today's discounts (percent), or null when no offer is running. */
  offer: { fullPct: number | null; planPct: number | null } | null;
  /** How much higher a mortgage price is (percent), or null when not known. */
  mortgagePct: number | null;
  deposit: number;
  months: number;
  every: PlanEvery;
}

export interface PayResult {
  listPrice: number;
  /** Off (negative) or on (positive) the list price, in percent and dollars. */
  changePct: number;
  changeAmount: number;
  price: number;
  deposit: number;
  /** What is left after the deposit. */
  balance: number;
  /** A payment plan's payments: how many, each one, and the last (it takes the rounding). */
  payments: { count: number; amount: number; last: number; every: PlanEvery } | null;
}

/** A price less a percentage, to the whole dollar (as factsCore's discounted()). */
const off = (price: number, pct: number) => Math.round((price * (100 - pct)) / 100);

export function payFor(input: PayInput): PayResult {
  const list = Math.round(input.listPrice);
  let price = list;
  let changePct = 0;
  if (input.method === "full" && input.offer?.fullPct) {
    changePct = -input.offer.fullPct;
    price = off(list, input.offer.fullPct);
  } else if (input.method === "plan" && input.offer?.planPct) {
    changePct = -input.offer.planPct;
    price = off(list, input.offer.planPct);
  } else if (input.method === "mortgage" && input.mortgagePct) {
    changePct = input.mortgagePct;
    price = Math.round((list * (100 + input.mortgagePct)) / 100);
  }
  const deposit = Math.min(input.deposit, price);
  const balance = price - deposit;
  let payments: PayResult["payments"] = null;
  if (input.method === "plan") {
    const months = PLAN_MONTHS.includes(input.months as (typeof PLAN_MONTHS)[number]) ? input.months : 12;
    const count = input.every === "quarter" ? Math.max(1, Math.round(months / 3)) : months;
    const amount = Math.round(balance / count);
    payments = { count, amount, last: balance - amount * (count - 1), every: input.every };
  }
  return { listPrice: list, changePct, changeAmount: price - list, price, deposit, balance, payments };
}

/** The estimated building management fee for a home of this size: [low, high] dollars a month. */
export function monthlyFee(areaSqm: number): [number, number] {
  return [Math.round(areaSqm * FEE_PER_SQM.low), Math.round(areaSqm * FEE_PER_SQM.high)];
}

/** The mortgage note's percentage ("Unit prices for mortgage financing are 5% higher across the board." → 5). */
export function mortgagePctFrom(note: string | null | undefined): number | null {
  const m = note ? /(\d+(?:\.\d+)?)\s*%\s*higher/i.exec(note) : null;
  return m ? Number(m[1]) : null;
}
