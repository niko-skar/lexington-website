export function formatUSD(value: number) {
  return `$${value.toLocaleString("en-US")}`;
}

// Floor 0 is the ground floor — reads oddly as a bare "0" in floor tabs,
// tables, and unit cards, so it gets a proper label instead.
export function formatFloor(floor: number) {
  return floor === 0 ? "Ground" : String(floor);
}

// Converts a display phone number like "+233 (0)244 30 5262" into a dialable
// "tel:" value — the "(0)" trunk prefix is dropped, not just de-punctuated,
// since it's only meaningful for in-country dialing, not the +233 form.
export function phoneHref(phone: string) {
  return `tel:${phone.replace(/\(0\)/g, "").replace(/[^\d+]/g, "")}`;
}

// wa.me needs the full international number as bare digits — no "+", no
// "(0)" trunk prefix, same handling as phoneHref above.
export function whatsappUrl(phone: string, message?: string) {
  const digits = phone.replace(/\(0\)/g, "").replace(/\D/g, "");
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}
