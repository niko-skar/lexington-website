"use server";

import { headers } from "next/headers";

import { allow, connectionKey } from "@/lib/reservation/limit";
import { SLOT_RE, VISIT_INTERESTS, slotLabel, type SlotKey, type VisitRow } from "@/lib/siteVisits/shared";
import { bookVisit, cancelVisit, changeVisit, tokenOk } from "@/lib/siteVisits/store";

// The booking page (/visit) and the visitor's own page to change or cancel (/visit/manage). The rules are in
// lib/siteVisits; this only reads and checks what the page sent.

export interface VisitFormState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string>;
  /** After "that time has just gone": other free times. */
  alternatives?: SlotKey[];
  booked?: { slot: string; firstName: string; manageUrl: string; icsUrl: string; emailed: boolean; email: string };
}

// Picking a time and typing a name and a number takes longer than this.
const MIN_FILL_MS = 4000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CHARS_RE = /^[\d\s+().-]+$/;

const text = (formData: FormData, name: string, max: number) => String(formData.get(name) ?? "").trim().slice(0, max);
const oneLine = (value: string) => value.replace(/\s+/g, " ");

/** The CRM's source for a brand-new prospect, from the advert that brought them (utm_source). */
function leadSourceFrom(utm: string): string {
  const s = utm.toLowerCase();
  if (/facebook|instagram|\bfb\b|\big\b|meta/.test(s)) return "meta_ads";
  if (/google|adwords|gads/.test(s)) return "google_ads";
  return "website";
}

export async function submitVisit(_prev: VisitFormState, formData: FormData): Promise<VisitFormState> {
  // Honeypot: a real visitor never sees this field. A bot is told "thank you" and nothing is booked.
  if (text(formData, "website_url", 200)) return { status: "success", message: "Thank you." };

  const startedAt = Number(formData.get("started"));
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FILL_MS) {
    return { status: "error", message: "That was very quick. Please check your details, then press the button again." };
  }

  const errors: Record<string, string> = {};
  const slot = text(formData, "slot", 20);
  const name = oneLine(text(formData, "name", 120));
  const phone = oneLine(text(formData, "phone", 40));
  const email = text(formData, "email", 160).toLowerCase();
  const peopleRaw = text(formData, "people", 3);
  const interest = text(formData, "interest", 40);
  const note = text(formData, "note", 1000);
  const utm = text(formData, "utm_source", 80);

  if (!SLOT_RE.test(slot)) errors.slot = "Please pick a day and a time.";
  if (name.length < 2 || !/\p{L}/u.test(name)) errors.name = "Please enter your name.";
  const digits = phone.replace(/\D/g, "");
  if (!PHONE_CHARS_RE.test(phone) || digits.length < 7 || digits.length > 15) errors.phone = "Please enter your phone or WhatsApp number, with the country code.";
  if (email && !EMAIL_RE.test(email)) errors.email = "Please check your email address (or leave it empty).";
  const people = peopleRaw ? Number(peopleRaw) : null;
  if (people !== null && (!Number.isInteger(people) || people < 1 || people > 10)) errors.people = "Please choose how many of you are coming.";
  if (interest && !(VISIT_INTERESTS as readonly string[]).includes(interest)) errors.interest = "Please choose one of the options.";
  if (Object.keys(errors).length) {
    return { status: "error", message: "Please check the details marked below.", fieldErrors: errors };
  }

  // A speed bump per connection (loose: many phones share one address) and for the whole site.
  const key = connectionKey(await headers());
  if (!allow(`visit:${key}`, 6, 30 * 60_000) || !allow("visit:all", 120, 60 * 60_000)) {
    return { status: "error", message: "We've had a lot of bookings from this connection. Please try again in a little while, or call or WhatsApp us." };
  }

  const result = await bookVisit({ slot, name, phone, email, people, interest, note, source: "website", leadSource: leadSourceFrom(utm) });
  if (!result.ok) {
    if (result.reason === "taken") {
      return {
        status: "error",
        message: `Sorry, ${slotLabel(slot)} has just been booked by someone else. Please pick another time.`,
        fieldErrors: { slot: "That time has just gone." },
        alternatives: result.alternatives,
      };
    }
    if (result.reason === "closed") {
      return {
        status: "error",
        message: "That time can't be booked any more. Please pick another one.",
        fieldErrors: { slot: "Please pick another time." },
        alternatives: result.alternatives,
      };
    }
    return { status: "error", message: "We couldn't book your visit just now. Please try again in a minute, or call or WhatsApp us and we'll book it for you." };
  }
  return {
    status: "success",
    message: "Your visit is booked.",
    booked: {
      slot: result.visit.slot,
      firstName: name.split(/\s+/)[0] || name,
      manageUrl: result.manageUrl,
      icsUrl: result.icsUrl,
      emailed: result.emailed,
      email,
    },
  };
}

export type ManageResult = { ok: true; message: string; visit: VisitRow } | { ok: false; message: string; alternatives?: SlotKey[] };

/** A new time for their own visit (or another visit after a missed or cancelled one). */
export async function changeOwnVisit(id: string, token: string, slot: string): Promise<ManageResult> {
  if (typeof id !== "string" || typeof token !== "string" || !tokenOk(id, token)) return { ok: false, message: "This link isn't valid. Please use the link in your email, or call us." };
  if (typeof slot !== "string" || !SLOT_RE.test(slot)) return { ok: false, message: "Please pick a day and a time." };
  const key = connectionKey(await headers());
  if (!allow(`visit-change:${key}`, 10, 30 * 60_000)) return { ok: false, message: "Too many changes from this connection. Please try again in a little while, or call us." };
  const result = await changeVisit(id, slot, "visitor");
  if (result.ok) return { ok: true, message: `Done: your visit is now ${slotLabel(result.visit.slot)}.`, visit: result.visit };
  if (result.reason === "taken") return { ok: false, message: `Sorry, ${slotLabel(slot)} has just been booked. Please pick another time.`, alternatives: result.alternatives };
  if (result.reason === "closed") return { ok: false, message: "That time can't be booked any more. Please pick another one.", alternatives: result.alternatives };
  if (result.reason === "gone") return { ok: false, message: "We couldn't find this visit. Please call or WhatsApp us." };
  return { ok: false, message: "We couldn't change it just now. Please try again in a minute, or call us." };
}

export async function cancelOwnVisit(id: string, token: string): Promise<ManageResult> {
  if (typeof id !== "string" || typeof token !== "string" || !tokenOk(id, token)) return { ok: false, message: "This link isn't valid. Please use the link in your email, or call us." };
  const result = await cancelVisit(id, "visitor");
  if (result.ok && result.visit) return { ok: true, message: "Your visit is cancelled. You are welcome to book another time whenever it suits you.", visit: result.visit };
  return { ok: false, message: "We couldn't cancel it just now. Please try again in a minute, or call us." };
}
