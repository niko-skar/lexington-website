/**
 * The chat agent's rules (Niko, 23 Oct 2026: "get the ai agents to respond to my facebook and
 * whatsapp messages for me"; it answers by itself and hands the hard ones to him). Pure, so every
 * rule can be tested; lib/agents/chat.ts receives the messages, keeps the conversations and sends.
 *
 * - It answers from the website's facts only (the same fact pack and fact check as the email
 *   replies), short, in the language they wrote in. Homes go as the website's own cards (a picture
 *   of each with its floor plan, size, floor and price; Niko, 23 Oct 2026: "that response is too
 *   long and too many numbers"), so its words stay short and nearly free of figures.
 * - It hands over to Niko (an alert, a step in Prospects) when someone wants a viewing or a call,
 *   asks how to pay or for bank details, wants a better price, asks a legal or contract question,
 *   complains, asks for a person, or asks something the facts don't answer. Its reply then says the
 *   sales team will get back to them, and it goes quiet in that chat for 12 hours (sooner if he
 *   answers, and then 12 hours from his last message).
 * - Its first message in a chat says it is The Lexington's assistant and that the team sees every
 *   message (Meta's and WhatsApp's rules for automated replies, and simply honest); asked directly
 *   whether they're talking to a person, it says so plainly.
 * - "Stop" ends its replies in that chat. More than eight replies in an hour hands over too.
 */

export type ChatChannel = "messenger" | "instagram" | "whatsapp";

export const CHANNEL_NAMES: Record<ChatChannel, string> = {
  messenger: "Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

export interface ChatMessage {
  _key: string;
  from: "them" | "agent" | "owner";
  text: string;
  at: string;
  /** The message's id on Meta's side, so a delivery twice is seen once. */
  mid?: string;
  /** The residences sent as cards right after this message (unit numbers). */
  cards?: string[];
  /** Those cards' ids on Meta's side, so their echoes are known as the assistant's own. */
  cardMids?: string[];
}

export interface ChatThread {
  _id: string;
  _type: "chatThread";
  channel: ChatChannel;
  /** Who it is on that channel: a Messenger or Instagram id, or a WhatsApp number. */
  senderId: string;
  name?: string | null;
  leadId?: string | null;
  messages: ChatMessage[];
  handedOver?: { at: string; reason: string } | null;
  /** Niko answered himself: the agent stays quiet until then. */
  ownerActiveUntil?: string | null;
  optedOut?: boolean | null;
  /** One reply at a time per chat. */
  lockedUntil?: string | null;
  /** The last time Niko was emailed about this chat (at most one email an hour). */
  notifiedAt?: string | null;
}

export const OWNER_QUIET_HOURS = 12;
const MAX_REPLIES_PER_HOUR = 8;

/** Why the agent doesn't answer this chat now, or null when it should. */
export function quietReason(thread: ChatThread, nowMs: number): string | null {
  if (thread.optedOut) return "They asked not to get replies.";
  if (thread.ownerActiveUntil && Date.parse(thread.ownerActiveUntil) > nowMs) return "You are answering this chat yourself.";
  if (thread.handedOver && nowMs - Date.parse(thread.handedOver.at) < OWNER_QUIET_HOURS * 3_600_000) return "It was handed over to you.";
  return null;
}

/** Too many replies in the last hour (a loop, or someone testing it): hand over instead. */
export function tooChatty(thread: ChatThread, nowMs: number): boolean {
  return thread.messages.filter((m) => m.from === "agent" && nowMs - Date.parse(m.at) < 3_600_000).length >= MAX_REPLIES_PER_HOUR;
}

/** "Stop", "unsubscribe": no more replies in this chat. */
export function wantsNoReplies(text: string): boolean {
  return /^\s*(stop|unsubscribe|stop messaging( me)?|don'?t (message|text) me)\s*[.!]*\s*$/i.test(text);
}

export type HandoverTopic = "viewing" | "payment" | "price" | "legal" | "complaint" | "person" | "unknown" | "none";

/** What in their words always goes to Niko, whatever the agent thinks. */
export function handoverTopic(text: string): HandoverTopic {
  if (/\b(bank|account (number|details)|transfer|wire|deposit|momo|mobile money|send (you )?money|pay(ment)? (now|today|link)|how (do|can) i pay|invoice)\b/i.test(text)) return "payment";
  if (/\b(view(ing)?|visit|come (and|to) see|see the (site|flat|apartment|unit)|inspect|tour|video call|meet(ing)?|appointment|call me|phone me|ring me)\b/i.test(text)) return "viewing";
  if (/\b(discount|negotiat\w*|lower (the )?price|best price|last price|reduce|cheaper|deal)\b/i.test(text)) return "price";
  if (/\b(lawyer|solicitor|contract|agreement|title|deed|indenture|lease|land|refund|cancel)\b/i.test(text)) return "legal";
  if (/\b(complain\w*|scam|fraud|angry|disappointed|terrible|useless)\b/i.test(text)) return "complaint";
  if (/\b(real person|human|speak to (someone|a person|an agent|sales)|talk to (someone|a person)|manager|owner|niko)\b/i.test(text)) return "person";
  return "none";
}

export const HANDOVER_WORDS: Record<Exclude<HandoverTopic, "none">, string> = {
  viewing: "wants a viewing or a call",
  payment: "asks how to pay",
  price: "asks for a better price",
  legal: "has a legal or contract question",
  complaint: "is unhappy",
  person: "asks for a person",
  unknown: "asked something the website doesn't answer",
};

export const CHAT_SYSTEM = (channel: ChatChannel) => `You answer messages people send to The Lexington, a residential building under construction in Shiashie, East Legon, Accra, Ghana, on ${CHANNEL_NAMES[channel]}. You are The Lexington's assistant; the sales team sees every message and can step in.

Write like a helpful person on the sales team: warm, plain and short. One to three short sentences, at most 300 characters, at most one link. Keep figures out of your words: no prices, sizes or floor numbers (the cards show them). No hype words (luxury, exclusive, stunning, dream, world-class), no emojis, no markdown, at most one exclamation mark. Write in the language they wrote in.

HOME CARDS
- When they ask about homes, prices, sizes, floor plans or what is available, put up to three unit numbers in "cards": available units from the FACTS that fit what they told you (budget, type, what the home is for). Each card is sent as a picture right after your message: the unit's floor plan, floor, type, size and website price.
- Your words then only introduce the cards (for example "Here are three homes within your budget.") and ask one useful question. Don't repeat what the cards show.
- Leave "cards" empty when no card helps: a question about the location, the building's progress, a viewing or paying, or homes you already sent.
- The cards show the website prices. If the FACTS list an offer running now, you may mention it in a few words; never work out discounted prices yourself.

THE FACTS ARE ONLY WHAT YOU ARE GIVEN
- Use only the facts in the FACTS block: unit numbers, types, floors, sizes, prices, the offer, fees, finishes, extras, amenities, dates and links. Copy every number exactly as given. Never work out a new number: no monthly instalments, totals, savings, yields or returns.
- Only offer units whose status is available. Only use links that appear in the FACTS block.
- Never write bank or account details. Never name the developer company. The only rooftop amenity is the Private Resident's Rooftop Garden; the swimming pool is not on the roof.
- If they ask whether they are talking to a person or a machine, say plainly that you are The Lexington's assistant and that the sales team reads every message and can take over.

HAND OVER TO THE SALES TEAM (handover: true) when they:
- want a viewing, a site visit, a video call or a phone call: don't book anything; say the team will get in touch to arrange it, and ask for a day and time that suits them and a WhatsApp number or email if you don't have one;
- ask how to pay, for bank details, or want to reserve now: explain what the FACTS say about reserving and paying, and say the team will contact them to agree how they pay;
- ask for a better price or a discount beyond the website's offer, or ask legal, title, contract or refund questions;
- complain, are upset, or ask to speak to a person;
- ask anything the FACTS don't answer: say the team will come back to them on it.
When you hand over, your reply still answers what the FACTS can, then says the team will be in touch soon.

ALSO
- Learn who they are as you go: ask for their name and a WhatsApp number or email only when it helps (once is enough), and never ask again for what they already told you.
- temperature: "hot" for a clear sign they want to act soon (a specific unit, a viewing, how to pay or reserve, buying within a month); "warm" for genuine interest; "cold" for spam, agents selling something, or just browsing.
- name, email, phone, interest, budget: what they have told you so far in this chat (empty when not said). interest is the unit type or unit they want.
- topic: what kind of question needs the team: viewing, payment, price, legal, complaint, person, unknown, or none.`;

export const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    handover: { type: "boolean" },
    topic: { type: "string", enum: ["viewing", "payment", "price", "legal", "complaint", "person", "unknown", "none"] },
    handover_reason: { type: "string" },
    temperature: { type: "string", enum: ["hot", "warm", "cold"] },
    name: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    interest: { type: "string" },
    budget: { type: "string" },
    cards: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "handover", "topic", "handover_reason", "temperature", "name", "email", "phone", "interest", "budget", "cards"],
  additionalProperties: false,
} as const;

export interface ChatOut {
  reply: string;
  /** Unit numbers to send as cards after the reply (checked against the available units). */
  cards: string[];
  handover: boolean;
  topic: HandoverTopic;
  handover_reason: string;
  temperature: "hot" | "warm" | "cold";
  name: string;
  email: string;
  phone: string;
  interest: string;
  budget: string;
}

/** The conversation for Claude: the facts, then the last messages, oldest first. */
export function chatPrompt(facts: string, thread: ChatThread): string {
  const lines = thread.messages
    .slice(-20)
    .map((m) => `${m.from === "them" ? "THEM" : m.from === "agent" ? "YOU" : "SALES TEAM"}: ${m.text}${m.cards?.length ? ` [cards sent: ${m.cards.join(", ")}]` : ""}`);
  return [
    `FACTS\n${facts}`,
    thread.name ? `THEIR NAME (from ${CHANNEL_NAMES[thread.channel]}): ${thread.name}` : "",
    thread.channel === "whatsapp" ? `THEIR WHATSAPP NUMBER: ${thread.senderId}` : "",
    `THE CHAT SO FAR\n${lines.join("\n")}`,
    "Write your next message.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The first line of the agent's first message in a chat (short: the sales team sees the chat too). */
export function introLine(): string {
  return "Hi, this is The Lexington's assistant (our sales team sees this chat too).";
}

/** The cards to send: available units only, as the website names them, at most three, each once. Pure. */
export function pickCards(requested: string[], units: Array<{ unitNumber: string; status: string }>): string[] {
  const key = (s: string) => s.toLowerCase().replace(/^unit\s+/, "").replace(/\s+/g, "");
  const out: string[] = [];
  for (const want of requested) {
    const unit = units.find((u) => u.status === "available" && key(u.unitNumber) === key(String(want)));
    if (unit && !out.includes(unit.unitNumber)) out.push(unit.unitNumber);
    if (out.length === 3) break;
  }
  return out;
}

/** Sent instead of a reply that didn't pass the checks, or when Claude can't be reached. */
export function holdingMessage(name?: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return `Thank you${first ? `, ${first}` : ""}. I've passed your message to The Lexington's sales team, who will get back to you shortly.`;
}

// ---- what Meta sends ---------------------------------------------------------------------------

/** A message from someone, or one Niko sent himself (from Business Suite, Messenger, Instagram or the WhatsApp Business app). */
export type ChatEvent =
  | { kind: "incoming"; channel: ChatChannel; senderId: string; text: string; mid: string; at: string; name?: string }
  | { kind: "owner"; channel: ChatChannel; senderId: string; text: string; mid: string; at: string; fromAgent: boolean };

/** Sent with every agent message on Messenger and Instagram, and echoed back: how its own messages are told apart from Niko's. */
export const AGENT_METADATA = "lexington-agent";

interface MessagingItem {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; app_id?: number | string; metadata?: string; attachments?: Array<{ type?: string }> };
}

const textOf = (text: string | undefined, attachments: Array<{ type?: string }> | undefined) =>
  (text ?? "").trim() || (attachments?.length ? `[${attachments.map((a) => a.type ?? "attachment").join(", ")}]` : "");

/** The messages in one webhook delivery from Meta (Messenger, Instagram or WhatsApp). Pure. */
export function parseWebhook(body: unknown, appId?: string): ChatEvent[] {
  const b = body as { object?: string; entry?: Array<{ messaging?: MessagingItem[]; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> } | null;
  const out: ChatEvent[] = [];
  if (!b || !Array.isArray(b.entry)) return out;
  if (b.object === "page" || b.object === "instagram") {
    const channel: ChatChannel = b.object === "page" ? "messenger" : "instagram";
    for (const entry of b.entry) {
      for (const m of entry.messaging ?? []) {
        const msg = m.message;
        if (!msg?.mid) continue; // deliveries, reads, reactions
        const text = textOf(msg.text, msg.attachments);
        const at = new Date(m.timestamp ?? Date.now()).toISOString();
        if (msg.is_echo) {
          const customer = m.recipient?.id;
          if (!customer) continue;
          const fromAgent = msg.metadata === AGENT_METADATA || (appId !== undefined && String(msg.app_id ?? "") === appId);
          out.push({ kind: "owner", channel, senderId: customer, text, mid: msg.mid, at, fromAgent });
        } else if (m.sender?.id && text) {
          out.push({ kind: "incoming", channel, senderId: m.sender.id, text, mid: msg.mid, at });
        }
      }
    }
  } else if (b.object === "whatsapp_business_account") {
    for (const entry of b.entry) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        if (change.field === "messages") {
          const contacts = (value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined) ?? [];
          for (const m of (value.messages as Array<{ from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } }> | undefined) ?? []) {
            if (!m.from || !m.id) continue;
            const text = (m.text?.body ?? "").trim() || `[${m.type ?? "message"}]`;
            const name = contacts.find((c) => c.wa_id === m.from)?.profile?.name;
            out.push({ kind: "incoming", channel: "whatsapp", senderId: m.from, text, mid: m.id, at: new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()).toISOString(), ...(name && { name }) });
          }
        } else if (change.field === "smb_message_echoes") {
          // Sent from the WhatsApp Business app on Niko's phone (messages the agent sends don't come back here).
          for (const m of (value.message_echoes as Array<{ to?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } }> | undefined) ?? []) {
            if (!m.to || !m.id) continue;
            out.push({ kind: "owner", channel: "whatsapp", senderId: m.to, text: (m.text?.body ?? "").trim() || `[${m.type ?? "message"}]`, mid: m.id, at: new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()).toISOString(), fromAgent: false });
          }
        }
      }
    }
  }
  return out;
}

/** What is wrong with a reply, beyond the fact check. */
export function chatProblems(reply: string): string[] {
  const out: string[] = [];
  if (!reply.trim()) out.push("The reply is empty.");
  if (reply.length > 450) out.push(`The reply is ${reply.length} characters (at most 300).`);
  if ((reply.match(/(US)?\$\s?\d[\d,.]*\s*(k\b)?/gi) ?? []).length > 1) out.push("It quotes prices in its words (the cards show them).");
  if (/\b(account (no|number)|iban|swift|sort code|routing number)\b/i.test(reply)) out.push("It mentions bank details.");
  if (/(https?:\/\/\S+[\s\S]*){2,}/.test(reply)) out.push("It has more than one link.");
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(reply)) out.push("It has emojis.");
  return out;
}
