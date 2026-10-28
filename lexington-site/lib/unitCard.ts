import { createHash } from "node:crypto";

import { NO_VAT, vatKey, type Vat } from "@/lib/vat";

// The version of a residence's card picture (app/api/unit-card): its figures, so the address changes
// when a price or status does. The chat asks for the current one; any other address is sent to it, so
// only the current card is ever drawn (and then served from the cache), however often it is asked for.
export function cardVersion(
  unit: { priceUSD: number; status: string; areaSqm: number; floor: number; type: string },
  vat: Vat = NO_VAT,
): string {
  // While VAT is off the address is the same as before VAT existed, so cards already sent keep working.
  const v = vat.on ? `|${vatKey(vat)}` : "";
  return createHash("sha1").update(`${unit.priceUSD}|${unit.status}|${unit.areaSqm}|${unit.floor}|${unit.type}${v}`).digest("hex").slice(0, 10);
}
