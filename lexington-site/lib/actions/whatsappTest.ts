"use server";

import { sendFirstTemplate } from "@/lib/agents/whatsapp";
import { failureWords, whatsAppNumber } from "@/lib/agents/whatsappCore";
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
