"use server";

import { registerWhatsAppNumber, sendFirstTemplate } from "@/lib/agents/whatsapp";
import { failureWords, registerFailureWords, whatsAppNumber } from "@/lib/agents/whatsappCore";
import { getAdminSession } from "@/lib/auth/session";

export interface WhatsAppTestState {
  status: "idle" | "ok" | "error";
  message: string;
}

/**
 * The Connect page's "Send a test": the first message (the approved template) to one number Niko types, from The
 * Lexington's WhatsApp number. While that is Meta's test number, only its (up to five) test numbers can get it.
 */
export async function testWhatsAppAction(_prev: WhatsAppTestState, formData: FormData): Promise<WhatsAppTestState> {
  if (!(await getAdminSession())) return { status: "error", message: "Please sign in again." };
  const to = whatsAppNumber(String(formData.get("number") || ""));
  const name = String(formData.get("name") || "").trim().slice(0, 60);
  if (!to) return { status: "error", message: "That doesn't look like a phone number. Type it with its country code, like +233 24 123 4567." };
  const result = await sendFirstTemplate(to, name);
  return result.ok
    ? { status: "ok", message: `Sent to +${to}. It should arrive on WhatsApp in a few seconds.` }
    : { status: "error", message: `Not sent: ${failureWords(result.error)}. (${result.error})` };
}

/**
 * The Connect page's "Switch on the number" (Meta's "register", only possible through the API): once per number, with 6
 * digits Niko chooses, which become the number's WhatsApp PIN. The digits are passed to Meta and never kept.
 */
export async function registerWhatsAppAction(_prev: WhatsAppTestState, formData: FormData): Promise<WhatsAppTestState> {
  if (!(await getAdminSession())) return { status: "error", message: "Please sign in again." };
  const pin = String(formData.get("pin") || "").trim();
  if (!/^\d{6}$/.test(pin)) return { status: "error", message: "The PIN must be exactly 6 digits." };
  const result = await registerWhatsAppNumber(pin);
  return result.ok
    ? { status: "ok", message: "Switched on. Give Meta a minute, then press Send a test." }
    : { status: "error", message: `Not switched on: ${registerFailureWords(result.error)}. (${result.error})` };
}
