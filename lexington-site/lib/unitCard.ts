import { createHash } from "node:crypto";

// The version of a residence's card picture (app/api/unit-card): its figures, so the address changes
// when a price or status does. The chat asks for the current one; any other address is sent to it, so
// only the current card is ever drawn (and then served from the cache), however often it is asked for.
export function cardVersion(unit: { priceUSD: number; status: string; areaSqm: number; floor: number; type: string }): string {
  return createHash("sha1").update(`${unit.priceUSD}|${unit.status}|${unit.areaSqm}|${unit.floor}|${unit.type}`).digest("hex").slice(0, 10);
}
