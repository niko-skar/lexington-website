/**
 * Where to send the price list: the one box takes an email address or a WhatsApp number (25 Nov 2026). Pure, so it can
 * be tested.
 */
export type PriceListContact = { kind: "email"; email: string } | { kind: "whatsapp"; phone: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CHARS_RE = /^\+?[\d\s().-]+$/;

export function parsePriceListContact(raw: string): PriceListContact | null {
  const value = raw.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!value) return null;
  if (value.includes("@")) {
    const email = value.replace(/\s/g, "").toLowerCase();
    return EMAIL_RE.test(email) ? { kind: "email", email } : null;
  }
  const digits = value.replace(/\D/g, "");
  if (!PHONE_CHARS_RE.test(value) || digits.length < 9 || digits.length > 15) return null;
  return { kind: "whatsapp", phone: value };
}
