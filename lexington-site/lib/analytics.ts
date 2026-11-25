/**
 * Thin wrapper over the GTM dataLayer. Components push semantic events here and
 * GTM decides which tags (GA4, Meta Pixel, Google Ads) each event maps to — so
 * marketing changes happen in the GTM UI, not in this codebase.
 *
 * Every push is a no-op until GTM is live (dataLayer only exists once the
 * container script from GoogleTagManager loads), so these calls are safe to
 * ship before the analytics accounts are set up.
 */

type DataLayerEvent = Record<string, unknown> & { event: string };

declare global {
  interface Window {
    dataLayer?: DataLayerEvent[];
    /** Meta's pixel, loaded by the tag manager (GTM) on public pages. */
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * The browser's half of a conversion the website has already reported to Meta itself (lib/meta/conversions.ts):
 * the same event name and id, so Meta counts the two as one. Lead = an enquiry or the price list, Schedule = a visit
 * or video tour booked, SubmitApplication = a reservation request. (The tag manager's old "Lead on every form" tag is
 * paused since 25 Nov 2026, so nothing is counted twice.) Nothing happens when the pixel is blocked: the website's
 * own report still goes.
 */
export function trackMetaEvent(event?: { name: string; id: string; contentName: string; unit?: string } | null) {
  if (typeof window === "undefined" || !event?.id || typeof window.fbq !== "function") return;
  try {
    window.fbq(
      "track",
      event.name,
      { content_name: event.contentName, content_category: "Apartments", ...(event.unit ? { content_ids: [event.unit] } : {}) },
      { eventID: event.id }
    );
  } catch {
    // The pixel is Meta's script: never let it break the page.
  }
}

export function pushEvent(event: DataLayerEvent) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(event);
}

/**
 * Primary conversion: a contact/availability enquiry was submitted successfully.
 * `generate_lead` is GA4's recommended event name, so it maps cleanly onto a
 * GA4 key event and a Google Ads / Meta lead conversion inside GTM.
 */
export function trackLead(details?: { unit?: string; form?: "contact" | "reservation" | "site_visit" | "video_tour" | "price_list" }) {
  pushEvent({
    event: "generate_lead",
    form_name: details?.form ?? "contact",
    ...(details?.unit ? { unit: details.unit } : {}),
  });
}
