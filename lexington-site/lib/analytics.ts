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
export function trackLead(details?: { unit?: string }) {
  pushEvent({
    event: "generate_lead",
    form_name: "contact",
    ...(details?.unit ? { unit: details.unit } : {}),
  });
}
