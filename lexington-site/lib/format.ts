export function formatUSD(value: number) {
  return `$${value.toLocaleString("en-US")}`;
}

// Converts a display phone number like "+233 (0)244 30 5262" into a dialable
// "tel:" value — the "(0)" trunk prefix is dropped, not just de-punctuated,
// since it's only meaningful for in-country dialing, not the +233 form.
export function phoneHref(phone: string) {
  return `tel:${phone.replace(/\(0\)/g, "").replace(/[^\d+]/g, "")}`;
}
