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
// leading zeros. Numbers typed the local Ghana way ("024 430 5262") get the
// 233 country code added; anything with an explicit "+" or "00" is already
// international and is left alone.
export function internationalDigits(phone: string) {
  const cleaned = phone.replace(/\(0\)/g, "").trim();
  const digits = cleaned.replace(/\D/g, "");
  if (cleaned.startsWith("+")) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0")) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

export function whatsappUrl(phone: string, message?: string) {
  return `https://wa.me/${internationalDigits(phone)}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}
