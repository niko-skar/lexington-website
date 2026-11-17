/**
 * The offer's words as the site settings hold them ("⚡UPDATE⚡ Phase 1 pricing ends 30th of
 * November — 15% off with full payment or …"), without the lightning bolts, split at the dash into
 * the headline and what the offer is. A message with no dash is all headline.
 */
export function splitOffer(message: string): { headline: string; detail: string } {
  const text = message
    .replace(/⚡\s*update\s*⚡/gi, "")
    .replace(/⚡/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const [headline, ...rest] = text.split(/\s[—–]\s/);
  return { headline: headline.trim(), detail: rest.join(" — ").trim() };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-12-01" -> "1 December". */
export function dayMonth(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]}`;
}

/**
 * The line under the offer about the one that follows it: "From 1 December: 10% off with full payment,
 * or 5% off with a payment plan." Its own words when they don't give both discounts.
 */
export function nextOfferLine(next: { startsOn: string; fullPaymentPct: number | null; planPct: number | null; text: string }): string {
  const terms =
    next.fullPaymentPct != null && next.planPct != null
      ? `${next.fullPaymentPct}% off with full payment, or ${next.planPct}% off with a payment plan.`
      : splitOffer(next.text).detail || splitOffer(next.text).headline;
  return `From ${dayMonth(next.startsOn)}: ${terms}`;
}
