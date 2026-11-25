import { createHash } from "node:crypto";

import { internationalDigits } from "@/lib/format";

/**
 * The website's own report to Meta of what a visitor did (Meta's "Conversions API"), Niko's step 2 of 25 Nov 2026:
 * Meta should see every enquiry even when the browser blocks the pixel, and see a visit booking as more than a
 * price-list request. Each kind is its own standard Meta event:
 *   Lead              an enquiry from the contact form, or the price list asked for
 *   Schedule          a site visit or a video tour booked
 *   SubmitApplication a reservation request (the fee form asked for)
 * The browser's pixel sends the same event with the same id (lib/analytics.ts trackMetaEvent), and Meta counts the
 * two as one. Contact details go to Meta only as SHA-256 codes, as Meta asks; the privacy page says so.
 *
 * Pure (no network, no request): the request is built here and sent by lib/meta/conversions.ts.
 */

export type MetaEventName = "Lead" | "Schedule" | "SubmitApplication";

export interface MetaWebsiteEvent {
  name: MetaEventName;
  /** The same id goes to the browser's pixel event, so Meta counts the two as one. */
  id: string;
  /** What it was, in Meta's reports: "Contact enquiry", "Price list", "Site visit", "Video tour", "Reservation". */
  contentName: string;
  /** The home it was about, when there was one ("104B"). */
  unit?: string;
}

export interface MetaPerson {
  email?: string;
  phone?: string;
  name?: string;
  /** Their record in Prospects: the same person across events. */
  externalId?: string;
}

export interface MetaRequestInfo {
  ip?: string;
  userAgent?: string;
  /** Meta's own browser cookies (_fbp, _fbc), set by the pixel. */
  fbp?: string;
  fbc?: string;
  /** The page the form was sent from (the Referer). */
  url?: string;
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Meta's rules for names: lower case, letters only (accents kept), no spaces or punctuation. */
const nameKey = (value: string) => value.toLowerCase().normalize("NFC").replace(/[^\p{L}]/gu, "");

/** fbc from the ad click (?fbclid=...) when the pixel could not set its own cookie. */
export function fbcFromUrl(url: string | undefined, nowMs: number): string | undefined {
  if (!url) return undefined;
  try {
    const fbclid = new URL(url).searchParams.get("fbclid")?.trim();
    return fbclid ? `fb.1.${nowMs}.${fbclid}` : undefined;
  } catch {
    return undefined;
  }
}

/** One event as Meta's Conversions API takes it: https://developers.facebook.com/docs/marketing-api/conversions-api */
export function buildCapiEvent(event: MetaWebsiteEvent, person: MetaPerson, info: MetaRequestInfo, nowMs = Date.now()) {
  const email = person.email?.trim().toLowerCase();
  const phone = person.phone ? internationalDigits(person.phone) : "";
  const [first, ...rest] = (person.name ?? "").trim().split(/\s+/);
  const firstKey = first ? nameKey(first) : "";
  const lastKey = rest.length ? nameKey(rest[rest.length - 1]) : "";
  const fbc = info.fbc?.trim() || fbcFromUrl(info.url, nowMs);

  const user_data: Record<string, string | string[]> = {};
  if (email && email.includes("@")) user_data.em = [sha256(email)];
  if (phone.length >= 7) user_data.ph = [sha256(phone)];
  if (firstKey) user_data.fn = [sha256(firstKey)];
  if (lastKey) user_data.ln = [sha256(lastKey)];
  if (person.externalId) user_data.external_id = [sha256(person.externalId)];
  if (info.ip) user_data.client_ip_address = info.ip;
  if (info.userAgent) user_data.client_user_agent = info.userAgent;
  if (info.fbp?.trim()) user_data.fbp = info.fbp.trim();
  if (fbc) user_data.fbc = fbc;

  return {
    event_name: event.name,
    event_time: Math.floor(nowMs / 1000),
    event_id: event.id,
    action_source: "website" as const,
    ...(info.url ? { event_source_url: info.url } : {}),
    user_data,
    custom_data: {
      content_name: event.contentName,
      content_category: "Apartments",
      ...(event.unit ? { content_ids: [event.unit] } : {}),
    },
  };
}

/** The client's first address from Vercel's headers ("x-real-ip", else the first of "x-forwarded-for"). */
export function clientIp(realIp: string | null, forwardedFor: string | null): string | undefined {
  const ip = realIp?.trim() || forwardedFor?.split(",")[0]?.trim();
  return ip || undefined;
}
