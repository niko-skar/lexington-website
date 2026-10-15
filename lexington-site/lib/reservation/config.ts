// What the "Reserve a residence" flow asks, in one place. The page, the form, the
// server action, the CRM note and both emails read these same lists, so an
// answer can never be offered on screen and then not understood by the server.
// No server-only imports here: the browser needs this file too.

/** The reservation fee, in US dollars. Same figure the site copy quotes everywhere ("$10,000"). */
export const RESERVATION_FEE_USD = 10000;

export interface Option {
  key: string;
  label: string;
}

// ---- about you ---------------------------------------------------------

export const COUNTRIES = [
  "Ghana",
  "United States",
  "United Kingdom",
  "Canada",
  "Netherlands",
  "Germany",
  "Italy",
  "Nigeria",
  "United Arab Emirates",
  "South Africa",
  "Australia",
] as const;

/** Picking this asks for the country in words. */
export const OTHER_COUNTRY = "Another country";

export const CONTACT_VIA: Option[] = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "phone", label: "Phone call" },
  { key: "email", label: "Email" },
];

// ---- what they want ----------------------------------------------------

/** The unit types as the unit list stores them, with how a buyer would say them. */
export const UNIT_TYPES: Array<Option & { fact: string; line: string }> = [
  { key: "Studio", label: "Studio", fact: "Studio", line: "Studio apartment" },
  { key: "One Bedroom", label: "One bedroom", fact: "One bedroom", line: "One-bedroom apartment" },
  { key: "Two Bedroom", label: "Two bedroom", fact: "Two bedroom", line: "Two-bedroom apartment" },
  { key: "Three Bedroom", label: "Three bedroom", fact: "Three bedroom", line: "Three-bedroom apartment" },
  {
    key: "3BR Duplex Penthouse",
    label: "Duplex penthouse",
    fact: "Duplex penthouse",
    line: "Three-bedroom duplex penthouse",
  },
];

/** "Not sure which": they want us to recommend. */
export const UNSURE_TYPE = "unsure";

export function unitTypeFor(bedroomType: string | undefined) {
  return UNIT_TYPES.find((t) => t.key === bedroomType);
}

export const PURPOSES: Option[] = [
  { key: "live", label: "To live in myself" },
  { key: "family", label: "A home for my family" },
  { key: "rent", label: "To rent it out" },
  { key: "holiday", label: "A holiday or second home" },
];

export const TIMELINES: Option[] = [
  { key: "week", label: "This week" },
  { key: "fortnight", label: "Within two weeks" },
  { key: "month", label: "Within a month" },
  { key: "unsure", label: "I'm not sure yet" },
];

export const VIEWINGS: Option[] = [
  { key: "visited", label: "I've already visited" },
  { key: "site", label: "I'd like a site visit" },
  { key: "video", label: "I'd like a video tour" },
  { key: "none", label: "I don't need one" },
];

// ---- how they will pay -------------------------------------------------

export const PAYMENTS: Option[] = [
  { key: "full", label: "Pay in full" },
  { key: "plan", label: "Payment plan" },
  { key: "mortgage", label: "Mortgage" },
  { key: "undecided", label: "Not decided yet" },
];

/** The CRM's own words for the same thing (lib/crm.ts PAYMENT_PREFS). */
export const CRM_PAYMENT: Record<string, string> = {
  full: "cash",
  plan: "plan",
  mortgage: "mortgage",
  undecided: "undecided",
};

export const BUYING_AS: Option[] = [
  { key: "self", label: "Myself" },
  { key: "joint", label: "Myself and someone else" },
  { key: "company", label: "Through a company" },
];

export const HEARD: Option[] = [
  { key: "meta", label: "Facebook or Instagram" },
  { key: "google", label: "Google search" },
  { key: "whatsapp", label: "WhatsApp or a friend" },
  { key: "agent", label: "An agent" },
  { key: "visit", label: "I visited the site" },
  { key: "other", label: "Somewhere else" },
];

/** Where a brand-new prospect is filed in the CRM, when their answer says it was an advert. */
export const CRM_SOURCE_FROM_HEARD: Record<string, string> = {
  meta: "meta_ads",
  google: "google_ads",
};

export function labelOf(list: Option[], key: string | undefined) {
  return list.find((o) => o.key === key)?.label;
}

/** The four steps, for the progress bar. */
export const STEPS = ["About you", "What you want", "How you'll pay", "Review"] as const;
