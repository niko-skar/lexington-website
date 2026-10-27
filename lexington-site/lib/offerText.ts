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
