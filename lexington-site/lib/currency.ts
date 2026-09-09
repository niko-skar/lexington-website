import type { Payment } from "@/lib/sanity/buyersTypes";

// USD is the currency contract prices and balances are tracked in, but
// buyers often pay in Cedis -- each payment stores the rate that actually
// applied on the day (entered in Studio, not fetched live: a bank's
// applied rate for a real payment can meaningfully differ from a generic
// market rate, so this is deliberately editable/overridable rather than
// automatic). Returns null when a GHS payment is missing its rate, so
// callers can flag it instead of silently mis-totalling the balance.
export function usdEquivalent(payment: Payment): number | null {
  if (payment.currency === "USD" || !payment.currency) {
    return payment.amount;
  }
  if (!payment.exchangeRate || payment.exchangeRate <= 0) {
    return null;
  }
  return payment.amount / payment.exchangeRate;
}

export function formatGHS(value: number) {
  return `GH₵${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function formatMethod(method?: string) {
  if (!method) return "—";
  if (method === "momo") return "Momo";
  if (method === "bank-transfer") return "Bank Transfer";
  if (method === "cash") return "Cash";
  return method;
}
