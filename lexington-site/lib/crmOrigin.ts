import { internationalDigits } from "@/lib/format";
import { sourceLabel } from "@/lib/crm";

// Where a prospect came from, Facebook or Instagram, and the link straight to their chat (Niko, 17 Nov 2026: "can you
// detail if they came from facebook or instagram and a link to the chat directly so i don't have to hunt for it").
// Pure, so it can be tested and used by both the server and the list.
//
// What we know, best first:
//   - their chat with the assistant: Messenger is Facebook, Instagram is Instagram;
//   - Meta's own word on a lead form entry (`platform`: "fb" or "ig", saved as metaPlatform);
//   - the advert's tag on a website visit (utm_source, saved as adSource: Instagram's own links say "ig").

export type Platform = "facebook" | "instagram";
export type ChatChannel = "messenger" | "instagram" | "whatsapp";

export interface ThreadRef {
  _id?: string;
  channel?: string | null;
  /** Who it is on that channel: the Messenger or Instagram id. */
  senderId?: string | null;
  /** An Instagram chat's own address, once looked up (lib/crmChatLinks.ts). */
  inboxUrl?: string | null;
}

export interface OriginFacts {
  source?: string | null;
  metaPlatform?: string | null;
  adSource?: string | null;
  metaInboxUrl?: string | null;
  /** The channel of their chat with the assistant, when there is one. */
  chatChannel?: string | null;
}

export function platformOf(f: OriginFacts): Platform | null {
  if (f.chatChannel === "instagram") return "instagram";
  if (f.chatChannel === "messenger") return "facebook";
  if (f.metaPlatform === "ig") return "instagram";
  if (f.metaPlatform === "fb") return "facebook";
  const tag = (f.adSource ?? "").trim().toLowerCase();
  if (/^(ig|instagram)\b/.test(tag)) return "instagram";
  if (/^(fb|facebook|messenger)\b/.test(tag)) return "facebook";
  // A Messenger lead form entry comes with a link to its Messenger chat.
  if (/^https:\/\/business\.facebook\.com\/latest\/\d+\?nav_ref=thread_view_by_psid$/.test(f.metaInboxUrl ?? "")) return "facebook";
  return null;
}

/** "Instagram ad", "Messenger message"... and the plain source name when it isn't known which. */
export function originLabel(f: OriginFacts): string {
  const p = platformOf(f);
  if (f.source === "meta_ads" && p) return p === "instagram" ? "Instagram ad" : "Facebook ad";
  if (f.source === "messenger" && p) return p === "instagram" ? "Instagram message" : "Messenger message";
  return sourceLabel(f.source ?? undefined);
}

// Meta's own link to a Messenger chat in Business Suite: the same address Meta puts on a lead form entry
// (field "inbox_url"), with the person's Messenger id. Checked on 17 Nov 2026 against 22 entries: always this shape.
export const messengerChatUrl = (psid: string) => `https://business.facebook.com/latest/${encodeURIComponent(psid)}?nav_ref=thread_view_by_psid`;

/** Business Suite's Instagram inbox: where an Instagram chat is when its own address isn't known. */
export const INSTAGRAM_INBOX = "https://business.facebook.com/latest/inbox/instagram_direct";

/**
 * An Instagram chat's address from Meta's id for the conversation. Meta's id is the conversation's name in base64 with
 * an "A" slipped in after each "Z" ("ig_dm:1:IGMessageThread:<our account>:<the chat's number>"); the chat's number
 * opens it on Instagram. Null when the id isn't that shape.
 */
export function instagramChatUrlFrom(conversationId: string): string | null {
  if (!/^[A-Za-z0-9+/=_-]{20,400}$/.test(conversationId)) return null;
  let words = "";
  try {
    const b64 = conversationId.replace(/ZA/g, "Z").replace(/-/g, "+").replace(/_/g, "/");
    words = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return null;
  }
  const m = /IGMessageThread:\d+:(\d{10,45})$/.exec(words);
  return m ? `https://www.instagram.com/direct/t/${m[1]}/` : null;
}

export interface ChatLink {
  url: string;
  /** "Instagram chat", "Messenger chat". */
  label: string;
  /** False when it opens the inbox rather than their own chat. */
  exact: boolean;
}

/** The link straight to their chat, from their chat with the assistant, else Meta's link on their form entry. */
export function chatLinkOf(thread: ThreadRef | null | undefined, metaInboxUrl?: string | null): ChatLink | null {
  if (thread?.channel === "messenger" && thread.senderId) return { url: messengerChatUrl(thread.senderId), label: "Messenger chat", exact: true };
  if (thread?.channel === "instagram") {
    return thread.inboxUrl ? { url: thread.inboxUrl, label: "Instagram chat", exact: true } : { url: INSTAGRAM_INBOX, label: "Instagram chats", exact: false };
  }
  if (metaInboxUrl && /^https:\/\/business\.facebook\.com\/latest\//.test(metaInboxUrl)) return { url: metaInboxUrl, label: "Messenger chat", exact: true };
  return null;
}

/**
 * The same phone number, however it was typed: the last nine digits (a Ghana number without its 0 or 233, and the
 * line number of most others). Catches "+1 571-435-3277" and "+150714353277" (a 0 typed by mistake).
 */
export function phoneTail(phone: string | null | undefined): string {
  const digits = internationalDigits(phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}
