// Reads and checks what the reservation form sent. Pure functions, no server-only
// imports, so the same rules can be tested without a server. The browser form
// checks each step for the visitor's sake; this is the check that counts.

import {
  BUYING_AS,
  CONTACT_VIA,
  COUNTRIES,
  HEARD,
  OTHER_COUNTRY,
  PAYMENTS,
  PURPOSES,
  TIMELINES,
  UNIT_TYPES,
  UNSURE_TYPE,
  VIEWINGS,
  type Option,
} from "./config";

export interface ReservationInput {
  name: string;
  email: string;
  phone: string;
  /** The country as it should be written down (the typed one when "Another country"). */
  country: string;
  city: string;
  contactVia: string;
  /** A unit type from UNIT_TYPES, or UNSURE_TYPE when they want advice. */
  unitType: string;
  /** A unit number, or "" when they only picked a type. */
  unit: string;
  purpose: string;
  timeline: string;
  viewing: string;
  payment: string;
  buyingAs: string;
  coBuyer: string;
  company: string;
  heard: string;
  note: string;
  utm: { source: string; medium: string; campaign: string; content: string };
}

export type FieldErrors = Record<string, string>;

export type Parsed =
  | { ok: true; input: ReservationInput }
  | { ok: false; step: number; message: string; fieldErrors: FieldErrors };

const text = (formData: FormData, name: string, max: number) =>
  String(formData.get(name) ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, max);

const oneLine = (value: string) => value.replace(/\s+/g, " ");

const inList = (list: Option[], key: string) => list.some((o) => o.key === key);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CHARS_RE = /^[\d\s+().-]+$/;
// Unit numbers are things like "205B", "PH2b" and "Studio 1".
const UNIT_RE = /^[A-Za-z0-9 -]{1,20}$/;

/** Which step each field lives on, so an error can send the visitor back to the right one. */
const STEP_OF: Record<string, number> = {
  name: 1,
  email: 1,
  phone: 1,
  country: 1,
  countryOther: 1,
  city: 1,
  unitType: 2,
  unit: 2,
  purpose: 2,
  timeline: 2,
  viewing: 2,
  payment: 3,
  buyingAs: 3,
  coBuyer: 3,
  company: 3,
  heard: 3,
  note: 3,
  consent: 4,
};

export function parseReservation(formData: FormData): Parsed {
  const errors: FieldErrors = {};
  const bad = (field: string, message: string) => {
    if (!errors[field]) errors[field] = message;
  };

  const name = oneLine(text(formData, "name", 120));
  const email = text(formData, "email", 160).toLowerCase();
  const phone = oneLine(text(formData, "phone", 40));
  const countryPick = text(formData, "country", 60);
  const countryOther = oneLine(text(formData, "countryOther", 60));
  const city = oneLine(text(formData, "city", 80));
  const contactVia = text(formData, "contactVia", 20) || "whatsapp";

  const unitType = text(formData, "unitType", 40);
  const unit = oneLine(text(formData, "unit", 20));
  const purpose = text(formData, "purpose", 20);
  const timeline = text(formData, "timeline", 20);
  const viewing = text(formData, "viewing", 20);

  const payment = text(formData, "payment", 20);
  const buyingAs = text(formData, "buyingAs", 20) || "self";
  const coBuyer = oneLine(text(formData, "coBuyer", 120));
  const company = oneLine(text(formData, "company", 120));
  const heard = text(formData, "heard", 20);
  const note = text(formData, "note", 1500);
  const consent = text(formData, "consent", 10) === "yes";

  // ---- step 1: about you ----
  if (name.length < 2 || !/\p{L}/u.test(name)) bad("name", "Please enter your full name.");
  if (!EMAIL_RE.test(email)) bad("email", "Please enter a valid email address. The form is sent there.");
  const phoneDigits = phone.replace(/\D/g, "");
  if (!PHONE_CHARS_RE.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
    bad("phone", "Please enter your phone or WhatsApp number, with the country code.");
  }
  let country = "";
  if (countryPick === OTHER_COUNTRY) {
    if (countryOther.length < 2) bad("countryOther", "Please tell us which country.");
    else country = countryOther;
  } else if ((COUNTRIES as readonly string[]).includes(countryPick)) {
    country = countryPick;
  } else {
    bad("country", "Please choose where you live.");
  }
  if (!inList(CONTACT_VIA, contactVia)) bad("contactVia", "Please choose how we should reach you.");

  // ---- step 2: what you want ----
  const typeOk = unitType === UNSURE_TYPE || UNIT_TYPES.some((t) => t.key === unitType);
  if (!typeOk) bad("unitType", "Please choose a type of residence, or tell us you'd like advice.");
  if (unit && !UNIT_RE.test(unit)) bad("unit", "That unit number doesn't look right.");
  if (!inList(PURPOSES, purpose)) bad("purpose", "Please tell us what the residence is for.");
  if (timeline && !inList(TIMELINES, timeline)) bad("timeline", "Please choose one of the options.");
  if (viewing && !inList(VIEWINGS, viewing)) bad("viewing", "Please choose one of the options.");

  // ---- step 3: how you'll pay ----
  if (!inList(PAYMENTS, payment)) bad("payment", "Please tell us how you expect to pay.");
  if (!inList(BUYING_AS, buyingAs)) bad("buyingAs", "Please choose who is buying.");
  if (buyingAs === "company" && company.length < 2) bad("company", "Please give the company's name.");
  if (heard && !inList(HEARD, heard)) bad("heard", "Please choose one of the options.");

  // ---- step 4: review ----
  if (!consent) bad("consent", "Please tick the box so we can use your details to deal with your reservation.");

  const failed = Object.keys(errors);
  if (failed.length > 0) {
    const step = Math.min(...failed.map((f) => STEP_OF[f] ?? 4));
    return {
      ok: false,
      step,
      message: errors[failed.find((f) => (STEP_OF[f] ?? 4) === step) as string],
      fieldErrors: errors,
    };
  }

  const utm = (key: string) => oneLine(text(formData, key, 80)).replace(/[^\w .:%+@/-]/g, "");
  return {
    ok: true,
    input: {
      name,
      email,
      phone,
      country,
      city,
      contactVia,
      unitType,
      unit,
      purpose,
      timeline,
      viewing,
      payment,
      buyingAs,
      coBuyer: buyingAs === "joint" ? coBuyer : "",
      company: buyingAs === "company" ? company : "",
      heard,
      note,
      utm: { source: utm("utm_source"), medium: utm("utm_medium"), campaign: utm("utm_campaign"), content: utm("utm_content") },
    },
  };
}
