import type { UnitStatus } from "@/lib/sanity/types";

/**
 * What the WhatsApp button in a home's pop-up (Residences) writes for the visitor (Niko, 24 Nov 2026: the pop-up had no
 * way to get in touch). It names the home, its size and the price they were looking at, so the reply can start from
 * there; a home already taken asks for a similar one.
 */
export function unitWhatsAppText(u: {
  unitNumber: string;
  bedroomType: string;
  status: UnitStatus;
  /** As the visitor sees it: "70 sqm" or "753 sq ft". */
  area: string;
  /** As shown: "$184,800 incl. VAT". */
  price: string;
  /** The finish package, when it isn't the one every home comes with. */
  finish: string | null;
}): string {
  if (u.status !== "available") {
    const kind = /penthouse/i.test(u.bedroomType) ? "penthouse" : u.bedroomType.toLowerCase();
    return `Hi, I saw that ${u.unitNumber} at The Lexington is ${u.status}. Do you have a similar ${kind} available?`;
  }
  const finish = u.finish ? ` with the ${u.finish} finish` : "";
  return `Hi, I'm interested in ${u.unitNumber} at The Lexington (${u.bedroomType}, ${u.area}, ${u.price}${finish}). Can you tell me more?`;
}
