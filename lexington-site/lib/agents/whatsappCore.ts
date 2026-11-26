// The first WhatsApp to a Facebook / Instagram lead form entry (Niko, 26 Nov 2026: "we can do the api ourselves ... just
// have to go out an get a new sim"). The Lexington's own WhatsApp number runs on Meta's WhatsApp Cloud API (no phone app):
// a few minutes after a form entry, once its email reply has been decided, the number sends one message Meta approved in
// advance (a template), and when they answer, the chat assistant takes over (lib/agents/chat.ts) as on Messenger.
// Pure, so every rule is tested on its own.

import { internationalDigits } from "@/lib/format";

export type WhatsAppMode = "off" | "on";

/** WHATSAPP_FIRST_MESSAGE=on switches the first message on; anything else leaves it off. */
export function whatsAppModeOf(setting: string | undefined): WhatsAppMode {
  return (setting ?? "").trim().toLowerCase() === "on" ? "on" : "off";
}

/** The template Meta approved (WhatsApp Manager), its language, and the words it says (kept with the chat). */
export const DEFAULT_TEMPLATE = "lexington_enquiry_reply";
export const DEFAULT_TEMPLATE_LANG = "en";

export function templateWords(first: string): string {
  return `Hi ${first}, thank you for your enquiry about The Lexington in East Legon. What kind of home are you looking for? Reply here and we'll send you the prices and floor plans.`;
}

/**
 * The name to greet them by: the first word of what they typed, written the usual way ("REDEEMER" and "redeemer" become
 * "Redeemer"), or "there" when nothing usable was typed (an initial, digits, an email address).
 */
export function greetingName(name: string | null | undefined): string {
  const word = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[\p{L}][\p{L}'’-]{1,29}$/u.test(word)) return "there";
  return word
    .split("-")
    .map((part) => (part ? part[0].toLocaleUpperCase("en") + part.slice(1).toLocaleLowerCase("en") : part))
    .join("-");
}

/** Their number as WhatsApp wants it (country code, no "+"), or "" when it can't be one. */
export function whatsAppNumber(phone: string | null | undefined): string {
  const digits = internationalDigits(phone ?? "");
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : "";
}

export interface FirstWhatsAppLead {
  _createdAt?: string;
  phone?: string | null;
  metaLeadId?: string | null;
  metaInboxUrl?: string | null;
  chatThread?: string | null;
  stage?: string | null;
  /** Its email reply: written (waiting for Niko), sent (by itself or by him), or put aside. */
  replyDraft?: { status?: string; sentVia?: string } | null;
  whatsappFirst?: { status?: string; attempts?: number } | null;
}

/** How long after the form entry the first WhatsApp may still go (older entries are left to Niko). */
export const FIRST_WITHIN_HOURS = 72;
/** A send that failed for a passing reason (Meta busy, no connection) is tried again, this many times in all. */
export const MAX_ATTEMPTS = 3;

/**
 * Whether this prospect gets the first WhatsApp now. Pure.
 * - Only a lead form entry (metaLeadId) with a number that can be a WhatsApp number, from the last three days.
 * - Never one already in a chat (Messenger, Instagram, or WhatsApp with us), nor one that already had it (sent, or
 *   failed for good).
 * - Only once its email reply has been decided, so the two never race: still New with the suggested reply waiting for
 *   Niko, or Contacted by that email (sent by itself or by him). Not when he put the reply aside ("I answered another
 *   way"), sent it on WhatsApp from his phone, or the prospect moved on.
 */
export function mayWhatsAppFirst(lead: FirstWhatsAppLead, nowMs: number): boolean {
  if (!lead.metaLeadId || !whatsAppNumber(lead.phone)) return false;
  if (lead.chatThread || lead.metaInboxUrl) return false;
  const first = lead.whatsappFirst;
  if (first && !(first.status === "retry" && (first.attempts ?? 0) < MAX_ATTEMPTS)) return false;
  const draft = lead.replyDraft;
  if (!draft) return false;
  const stage = lead.stage ?? "new";
  const emailed = draft.status === "sent" && (draft.sentVia === "auto-email" || draft.sentVia === "email");
  if (!((stage === "new" && draft.status === "draft") || (stage === "contacted" && emailed))) return false;
  const created = Date.parse(lead._createdAt ?? "");
  return Number.isFinite(created) && nowMs - created <= FIRST_WITHIN_HOURS * 3_600_000;
}

/** Their "Where do you live?" answer on the form, or "". */
export function whereTheyLive(answers: Array<{ question?: string; answer?: string }> | null | undefined): string {
  return (answers ?? []).find((a) => /where do you live/i.test(a.question ?? ""))?.answer?.trim() ?? "";
}

/**
 * Whether a first message may go at this hour: in their daytime. Ghana (GMT): 07:00-21:00. The USA and Canada: 13:00-
 * 01:00 GMT (8 am-8 pm on the east coast). Anywhere else: Ghana's hours. A form filled in at night gets its WhatsApp the
 * next morning. Pure.
 */
export function daytimeFor(where: string, nowMs: number): boolean {
  const hour = new Date(nowMs).getUTCHours();
  if (/usa|united states|america|canada/i.test(where)) return hour >= 13 || hour < 1;
  return hour >= 7 && hour < 21;
}

/** The request that sends the template (WhatsApp Cloud API, POST /{phone-number-id}/messages). Pure. */
export function templateRequest(to: string, template: string, lang: string, first: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: lang },
      components: [{ type: "body", parameters: [{ type: "text", text: first }] }],
    },
  };
}

/** WhatsApp lets a business write freely only within 24 hours of the person's last message; after that, a template only. */
export const REPLY_WINDOW_HOURS = 24;

export function replyWindowOpen(lastTheirsAt: string | null | undefined, nowMs: number): boolean {
  const at = Date.parse(lastTheirsAt ?? "");
  return Number.isFinite(at) && nowMs - at < REPLY_WINDOW_HOURS * 3_600_000;
}

/** A delivery report from WhatsApp about a message we sent. */
export interface WhatsAppStatus {
  mid: string;
  status: string;
  to: string;
  error?: string;
}

/** The delivery reports in one webhook delivery (sent, delivered, read, failed). Pure. */
export function parseStatuses(body: unknown): WhatsAppStatus[] {
  const b = body as { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> } | null;
  if (!b || b.object !== "whatsapp_business_account" || !Array.isArray(b.entry)) return [];
  const out: WhatsAppStatus[] = [];
  for (const entry of b.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      type Raw = { id?: string; status?: string; recipient_id?: string; errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }> };
      for (const s of (change.value?.statuses as Raw[] | undefined) ?? []) {
        if (!s.id || !s.status) continue;
        const e = s.errors?.[0];
        const error = e ? [e.code ? `(${e.code})` : "", e.title ?? e.message ?? "", e.error_data?.details ?? ""].filter(Boolean).join(" ").trim() : "";
        out.push({ mid: s.id, status: s.status, to: s.recipient_id ?? "", ...(error && { error }) });
      }
    }
  }
  return out;
}

/** What a failed first message means, in plain words for the CRM note. Pure. */
export function failureWords(error: string | undefined): string {
  const e = error ?? "";
  if (/131026|undeliverable|not.*whatsapp/i.test(e)) return "their number doesn't seem to be on WhatsApp";
  if (/131049|ecosystem|healthy/i.test(e)) return "WhatsApp held it back (it limits how many business messages one person gets)";
  if (/131047|24 hours|re-engagement/i.test(e)) return "more than 24 hours since their last message";
  if (/131050|stopped|opt/i.test(e)) return "they have stopped messages from businesses";
  if (/132001|template.*(not exist|does not exist)|132000/i.test(e)) return "the template isn't approved yet";
  if (/131030|allowed list|recipient.*list/i.test(e)) return "the test number can only message its five test numbers";
  return e ? `WhatsApp said: ${e}` : "WhatsApp didn't say why";
}
