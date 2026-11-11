import "server-only";

import { internationalDigits } from "@/lib/format";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

/**
 * The prospect who is this person: by email, else by phone number (written the local way or with +233), the oldest
 * record first, never `notId`. Used by the chat assistant (lib/agents/chat.ts) and the site-visit booking
 * (lib/siteVisits/store.ts), so one person stays one prospect however they reach us.
 */
export async function samePerson(email: string, phone: string, notId = ""): Promise<string | null> {
  const buyers = getBuyersClient();
  if (email.includes("@")) {
    const id = await buyers.fetch<string | null>(`*[_type == "lead" && lower(email) == $email && _id != $not] | order(_createdAt asc)[0]._id`, {
      email: email.trim().toLowerCase(),
      not: notId,
    });
    if (id) return id;
  }
  const digits = phone ? internationalDigits(phone).replace(/\D/g, "") : "";
  if (digits.length >= 9) {
    const withPhones = await buyers.fetch<Array<{ _id: string; phone: string }>>(`*[_type == "lead" && defined(phone) && _id != $not] | order(_createdAt asc){ _id, phone }`, {
      not: notId,
    });
    const same = withPhones.find((l) => internationalDigits(l.phone).replace(/\D/g, "") === digits);
    if (same) return same._id;
  }
  return null;
}
