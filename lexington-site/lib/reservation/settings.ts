import "server-only";

import { MAX_EXTRA_LINES } from "@/lib/reservation/pdf";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

// Where the money goes, kept in the PRIVATE buyers dataset (one document, edited
// in the buyers Studio under "Reservation form settings") rather than in the
// code: the account details never sit in the repository, and Niko can change
// them without a deploy.

export interface ReservationSettings {
  /** Off = hold every form: Niko is told and sends it himself. */
  autoSend: boolean;
  accountOwner: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  accountAddress: string;
  /** Extra lines such as international wire details, printed under the address. */
  extraLines: Array<{ label: string; value: string }>;
  paymentReference: string;
}

export const RESERVATION_SETTINGS_ID = "reservationSettings";

interface RawSettings {
  autoSend?: boolean;
  accountOwner?: string;
  bankName?: string;
  accountNumber?: string;
  routingNumber?: string;
  accountAddress?: string;
  extraLines?: Array<{ label?: string; value?: string }>;
  paymentReference?: string;
}

const clean = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// Null means "the form can't be built right now" (no settings, or a bank detail
// missing): the visitor's request is still saved and Niko is told, but no form
// with half a set of bank details is ever sent.
export async function getReservationSettings(): Promise<ReservationSettings | null> {
  try {
    const raw = await getBuyersClient().fetch<RawSettings | null>(`*[_id == $id][0]`, { id: RESERVATION_SETTINGS_ID });
    if (!raw) return null;
    const settings: ReservationSettings = {
      autoSend: raw.autoSend !== false,
      accountOwner: clean(raw.accountOwner),
      bankName: clean(raw.bankName),
      accountNumber: clean(raw.accountNumber, 60),
      routingNumber: clean(raw.routingNumber, 60),
      accountAddress: clean(raw.accountAddress),
      extraLines: (raw.extraLines ?? [])
        .map((l) => ({ label: clean(l.label, 40), value: clean(l.value, 120) }))
        .filter((l) => l.label && l.value)
        .slice(0, MAX_EXTRA_LINES),
      paymentReference: clean(raw.paymentReference) || "Your full name and the unit number",
    };
    const complete =
      settings.accountOwner && settings.bankName && settings.accountNumber && settings.routingNumber && settings.accountAddress;
    return complete ? settings : null;
  } catch (err) {
    console.error("Could not read the reservation form settings:", err);
    return null;
  }
}
