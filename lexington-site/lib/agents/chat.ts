import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { claudeConfigured, writeWithClaude } from "@/lib/ai/claude";
import { notifyOwner } from "@/lib/alerts/notify";
import { firstName, todayISO } from "@/lib/crm";
import { samePerson } from "@/lib/crmMatch";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { SITE_URL } from "@/lib/seo";
import { googleMapsUrl } from "@/lib/maps";
import { VISIT_PLACE, dayLabel, rangeLabel, slotDay, slotFromText, slotLabel, timeLabel, twoFreeTimes, type SlotKey } from "@/lib/siteVisits/shared";
import { VISIT_PREFIX, bookVisit, freeVisitSlots } from "@/lib/siteVisits/store";
import { cardVersion } from "@/lib/unitCard";
import { NO_VAT, type Vat } from "@/lib/vat";

import {
  AGENT_METADATA,
  CHANNEL_NAMES,
  CHAT_SCHEMA,
  CHAT_SYSTEM,
  FOLLOW_UP_BEFORE_HOURS,
  HANDOVER_WORDS,
  OWNER_QUIET_HOURS,
  PLACEHOLDER_NAME,
  SELLER_LOST_REASON,
  SELLER_REPLY,
  chatLeadId,
  chatProblems,
  chatPrompt,
  followUpDue,
  followUpFirstName,
  followUpText,
  formStarterContacts,
  handoverTopic,
  holdingMessage,
  introLine,
  joinRecords,
  livesAbroad,
  pickCards,
  quietReason,
  tooChatty,
  wantsNoReplies,
  type ChatChannel,
  type ChatEvent,
  type ChatMessage,
  type ChatOut,
  type ChatThread,
  type HandoverTopic,
} from "./chatCore";
import { factCheck } from "./factcheck";
import { loadFactPack } from "./facts";
import { factPackText, type UnitFact } from "./factsCore";
import { pageAccess } from "./metaLeads";

/**
 * THE CHAT AGENT (Niko, 23 Oct 2026: "get the ai agents to respond to my facebook and whatsapp
 * messages for me"; it answers by itself and hands the hard ones to him). Meta sends every new
 * message on the Page's Messenger, on Instagram and on WhatsApp to /api/meta/webhook; for each one
 * this answers from the website's facts (the rules are in chatCore.ts), keeps the chat in one
 * private document per person (`chat.<channel>.<id>`), puts the person in Prospects with the chat
 * in their timeline, and alerts Niko (the site app, a buzz on his phone) when it hands a chat
 * over. When he answers himself (in
 * Business Suite, Messenger, Instagram or the WhatsApp Business app) it goes quiet in that chat.
 *
 * Off with CHAT_AGENT=off, or Pause on the Connect page. WhatsApp needs WHATSAPP_PHONE_NUMBER_ID
 * and WHATSAPP_TOKEN (the number connected through a WhatsApp partner, keeping the phone app).
 */

const PROD = process.env.VERCEL_ENV === "production";
const SWITCH_ID = PROD ? "agentConfig.chat" : "agentConfig.chat-dev";
const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function threadIdFor(channel: ChatChannel, senderId: string): string {
  return `${PROD ? "chat" : "chat-dev"}.${channel}.${senderId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

export function chatAgentOn(): boolean {
  return process.env.CHAT_AGENT?.trim().toLowerCase() !== "off";
}

export async function readChatSwitch(): Promise<{ paused: boolean }> {
  try {
    const doc = await getBuyersClient().getDocument<{ paused?: boolean }>(SWITCH_ID);
    return { paused: doc?.paused === true };
  } catch {
    return { paused: false };
  }
}

export async function setChatPaused(paused: boolean): Promise<void> {
  await getBuyersClient().createOrReplace({ _id: SWITCH_ID, _type: "agentConfig", paused, changedAt: new Date().toISOString() });
}

/** Meta signs every delivery with the app secret: anything else is thrown away. */
export function signatureValid(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ---- sending ------------------------------------------------------------------------------------

function graphBase(): string {
  const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION ?? "") ? process.env.META_GRAPH_VERSION : "v23.0";
  const base =
    process.env.VERCEL_ENV !== "production" && process.env.META_GRAPH_BASE
      ? process.env.META_GRAPH_BASE.replace(/\/+$/, "")
      : "https://graph.facebook.com";
  return `${base}/${version}`;
}

/** Words, or a residence card's picture (by its address on the website). */
type Outgoing = { text: string } | { image: string };

/**
 * Sends one message on the chat's channel and returns its id. Throws in Meta's words. `tag`: a Messenger message that
 * isn't an answer (the site-visit reminder, an update to an event they booked).
 */
async function send(thread: ChatThread, outgoing: Outgoing, tag?: "CONFIRMED_EVENT_UPDATE"): Promise<string> {
  let url: string;
  let token: string;
  let body: Record<string, unknown>;
  if (thread.channel === "whatsapp") {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const waToken = process.env.WHATSAPP_TOKEN?.trim();
    if (!phoneId || !waToken) throw new Error("WhatsApp isn't connected yet (WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN).");
    url = `${graphBase()}/${phoneId}/messages`;
    token = waToken;
    const base = { messaging_product: "whatsapp", recipient_type: "individual", to: thread.senderId };
    body = "text" in outgoing ? { ...base, type: "text", text: { body: outgoing.text, preview_url: true } } : { ...base, type: "image", image: { link: outgoing.image } };
  } else {
    const access = await pageAccess();
    if (!access) throw new Error("The Facebook Page isn't connected (META_PAGE_ID and the Page key).");
    url = `${access.base}/${access.pageId}/messages`;
    token = access.token;
    const message =
      "text" in outgoing
        ? { text: outgoing.text, metadata: AGENT_METADATA }
        : {
            attachment: { type: "image", payload: { url: outgoing.image, ...(thread.channel === "messenger" ? { is_reusable: true } : {}) } },
            metadata: AGENT_METADATA,
          };
    body = { recipient: { id: thread.senderId }, ...(tag ? { messaging_type: "MESSAGE_TAG", tag } : { messaging_type: "RESPONSE" }), message };
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const out = (await response.json().catch(() => null)) as {
    message_id?: string;
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  } | null;
  if (!response.ok || out?.error) throw new Error(out?.error?.message ?? `Meta answered ${response.status}`);
  return out?.message_id ?? out?.messages?.[0]?.id ?? `sent-${newKey()}`;
}

/**
 * A message from The Lexington into a chat that isn't an answer: the site-visit reminder the day before
 * (lib/siteVisits/jobs.ts). Messenger allows it as an update to an event they booked (the CONFIRMED_EVENT_UPDATE tag);
 * Instagram and WhatsApp only within a day of their last message. Never throws.
 */
export async function remindInChat(threadId: string, text: string): Promise<"sent" | "closed" | "failed"> {
  try {
    const thread = await readThread(threadId);
    if (!thread || thread.optedOut) return "closed";
    const lastTheirs = [...thread.messages].reverse().find((m) => m.from === "them");
    const open = lastTheirs ? Date.now() - Date.parse(lastTheirs.at) < 23 * 3_600_000 : false;
    if (!open && thread.channel !== "messenger") return "closed";
    const mid = await send(thread, { text }, open ? undefined : "CONFIRMED_EVENT_UPDATE");
    const at = new Date().toISOString();
    await updateThread(threadId, (t) => ({ ...t, messages: keepLast([...t.messages, { _key: newKey(), from: "agent", text, at, mid }]) }), () => thread);
    await leadNote(thread.leadId, `${CHANNEL_NAMES[thread.channel]}, assistant (visit reminder): ${text}`);
    return "sent";
  } catch (error) {
    console.error("[chat] the visit reminder couldn't be sent:", error instanceof Error ? error.message : error);
    return "failed";
  }
}

/**
 * A residence's card picture on the website (app/api/unit-card). Its figures go into the address, so
 * when a price or status changes Meta and the website's cache fetch a fresh picture. A test copy can
 * point at itself with CARD_BASE_URL; the live site always uses its own address.
 */
function cardUrl(unit: UnitFact, vat: Vat): string {
  const base = (process.env.VERCEL_ENV !== "production" && process.env.CARD_BASE_URL?.replace(/\/+$/, "")) || SITE_URL;
  return `${base}/api/unit-card/${encodeURIComponent(unit.unitNumber)}?v=${cardVersion(unit, vat)}`;
}

/** Sends the cards after a reply (each one drawn first, so Meta never waits on it). Answers the ones that went. */
async function sendCards(thread: ChatThread, cards: UnitFact[], vat: Vat): Promise<Array<{ unit: string; mid: string }>> {
  if (!cards.length) return [];
  await Promise.allSettled(cards.map((u) => fetch(cardUrl(u, vat), { signal: AbortSignal.timeout(25_000), cache: "no-store" })));
  const sent: Array<{ unit: string; mid: string }> = [];
  for (const unit of cards) {
    try {
      sent.push({ unit: unit.unitNumber, mid: await send(thread, { image: cardUrl(unit, vat) }) });
    } catch (error) {
      console.error(`[chat] the ${unit.unitNumber} card couldn't be sent:`, error instanceof Error ? error.message : error);
    }
  }
  return sent;
}

// ---- the chat's document ---------------------------------------------------------------------------

async function readThread(id: string): Promise<ChatThread | null> {
  return (await getBuyersClient().getDocument<ChatThread & { _rev?: string }>(id)) ?? null;
}

/**
 * Changes one chat safely: read it, change it, write it only if nobody wrote in between (else
 * read again and redo the change). Returns the chat as written.
 */
async function updateThread(id: string, change: (t: ChatThread) => ChatThread | null, fresh: () => ChatThread): Promise<ChatThread | null> {
  const buyers = getBuyersClient();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = (await buyers.getDocument<ChatThread & { _rev?: string }>(id)) ?? null;
    const base = current ?? fresh();
    const next = change(structuredClone(base));
    if (!next) return base;
    // Sanity's own fields are never written back.
    const { _rev, _id, _type, _createdAt, _updatedAt, ...fields } = next as ChatThread & {
      _rev?: string;
      _createdAt?: string;
      _updatedAt?: string;
    };
    void _rev;
    void _id;
    void _type;
    void _createdAt;
    void _updatedAt;
    try {
      if (!current) await buyers.create({ ...fields, _id: id, _type: "chatThread" });
      else
        await buyers
          .patch(id)
          .ifRevisionId(current._rev as string)
          .set(fields)
          .commit();
      return next;
    } catch (error) {
      const e = error as { statusCode?: number; message?: string };
      if (e.statusCode !== 409 && !/revision|already exists/i.test(e.message ?? "")) throw error;
      await sleep(150 * (attempt + 1));
    }
  }
  throw new Error("The chat kept changing while it was being saved.");
}

const keepLast = (messages: ChatMessage[]) => messages.slice(-80);

// ---- the prospect in the CRM --------------------------------------------------------------------------

// samePerson (by email, else by phone number) lives in lib/crmMatch.ts: the site-visit booking uses it too.

async function ensureLead(thread: ChatThread): Promise<string | null> {
  if (thread.leadId) return thread.leadId;
  const buyers = getBuyersClient();
  try {
    // Who it is: a WhatsApp number, or the details a lead form's chat starts with. Someone already in Prospects (the lead
    // form's entry often arrives first) keeps their record, and the chat is added to it.
    const said = thread.messages.filter((m) => m.from === "them").map((m) => formStarterContacts(m.text)).find((c) => c.email || c.phone) ?? { name: "", phone: "", email: "" };
    const phone = thread.channel === "whatsapp" ? `+${thread.senderId}` : said.phone;
    const id = chatLeadId(thread._id);
    const same = await samePerson(said.email, phone, id);
    if (same) {
      await buyers.patch(same).setIfMissing({ chatThread: thread._id }).commit().catch(() => undefined);
      return same;
    }
    const now = new Date().toISOString();
    // One prospect per chat, whatever arrives at once: two of Nadim's messages together made two (6 Nov 2026).
    const doc = await buyers.createIfNotExists({
      _id: id,
      _type: "lead",
      name: thread.name?.trim() || said.name || `${CHANNEL_NAMES[thread.channel]} contact`,
      ...(phone && { phone }),
      ...(said.email && { email: said.email }),
      source: thread.channel === "whatsapp" ? "whatsapp" : "messenger",
      stage: "new",
      paymentPreference: "undecided",
      tasks: [],
      notes: [{ _key: newKey(), at: now, kind: "system", text: `Started a chat on ${CHANNEL_NAMES[thread.channel]}; The Lexington's assistant answers it.` }],
      chatThread: thread._id,
    });
    return doc._id;
  } catch (error) {
    console.error("[chat] could not add the prospect:", error instanceof Error ? error.message : error);
    return null;
  }
}

interface JoinableLead {
  _id: string;
  _rev: string;
  name?: string;
  email?: string;
  phone?: string;
  interest?: string;
  chatThread?: string;
  metaLeadId?: string;
  buyerAccountId?: string;
  unitNumber?: string;
  agreedPriceUSD?: number;
  notes?: Array<{ _key: string; at?: string; kind?: string; text?: string }>;
  tasks?: Array<{ _key: string; text?: string; done?: boolean }>;
}

/**
 * A chat's prospect that turns out to be someone already in Prospects (their email or number is on another record,
 * often the lead form's, which arrives a few seconds before or after the chat) is joined into that record: the chat,
 * its notes and open steps move there, and the chat's record goes. Only a record the chat made and nothing else has
 * written to (no form entry, buyer login or sale) is ever removed. Answers the prospect the chat now belongs to.
 */
async function joinSamePerson(leadId: string, threadId: string, channel: ChatChannel): Promise<string> {
  const buyers = getBuyersClient();
  try {
    const mine = await buyers.getDocument<JoinableLead>(leadId);
    if (!mine || mine.chatThread !== threadId || mine.metaLeadId || mine.buyerAccountId || mine.unitNumber || mine.agreedPriceUSD) return leadId;
    const otherId = await samePerson(mine.email ?? "", mine.phone ?? "", leadId);
    const other = otherId ? await buyers.getDocument<JoinableLead>(otherId) : null;
    if (!other) return leadId;
    const set = joinRecords(other, mine, {
      _key: newKey(),
      at: new Date().toISOString(),
      text: `Joined with the record the ${CHANNEL_NAMES[channel]} chat had started: the same ${mine.email && mine.email === other.email ? "email" : "phone number"}.`,
    });
    await buyers
      .transaction()
      .patch(other._id, (p) => p.ifRevisionId(other._rev).set(set))
      .patch(mine._id, (p) => p.ifRevisionId(mine._rev).set({ joinedInto: other._id }))
      .delete(mine._id)
      .patch(threadId, (p) => p.set({ leadId: other._id }))
      .commit();
    return other._id;
  } catch (error) {
    // A record changed meanwhile: left as it is, and the next message tries again.
    console.error("[chat] could not join the same person's records:", error instanceof Error ? error.message : error);
    return leadId;
  }
}

async function leadNote(leadId: string | null | undefined, text: string): Promise<void> {
  if (!leadId) return;
  await getBuyersClient()
    .transaction()
    .patch(leadId, (p) => p.setIfMissing({ notes: [] }))
    .patch(leadId, (p) => p.append("notes", [{ _key: newKey(), at: new Date().toISOString(), kind: "system", text: text.slice(0, 3000) }]))
    .commit()
    .catch((e: Error) => console.error("[chat] note not saved:", e.message));
}

/**
 * What the person said about themselves, onto their record (a name replaces only the placeholder). A new email or
 * number that is already someone's in Prospects joins the two. Answers the prospect the chat belongs to now.
 */
async function learnAbout(leadId: string | null | undefined, out: ChatOut, thread: ChatThread): Promise<string | null | undefined> {
  if (!leadId) return leadId;
  const buyers = getBuyersClient();
  const lead = await buyers.fetch<{ name?: string; email?: string; phone?: string; interest?: string } | null>(
    `*[_type == "lead" && _id == $id][0]{ name, email, phone, interest }`,
    { id: leadId }
  );
  if (!lead) return leadId;
  const set: Record<string, string> = {};
  if (out.name.trim() && (!lead.name || PLACEHOLDER_NAME.test(lead.name))) set.name = out.name.trim().slice(0, 120);
  if (out.email.includes("@") && !lead.email) set.email = out.email.trim().toLowerCase().slice(0, 160);
  if (out.phone.replace(/\D/g, "").length >= 9 && !lead.phone) set.phone = out.phone.trim().slice(0, 40);
  if (out.interest.trim() && !lead.interest) set.interest = out.interest.trim().slice(0, 120);
  if (Object.keys(set).length) await buyers.patch(leadId).set(set).commit().catch(() => undefined);
  return set.email || set.phone ? joinSamePerson(leadId, thread._id, thread.channel) : leadId;
}

/**
 * A seller or supplier's record leaves the pipeline: a new one becomes Lost ("Selling to us, not a buyer"), so it isn't
 * counted or chased as a buyer. A record already further along (a real prospect who wrote again) is left as it is.
 */
async function sellerOutOfPipeline(leadId: string | null | undefined): Promise<void> {
  if (!leadId) return;
  const buyers = getBuyersClient();
  try {
    const lead = await buyers.fetch<{ stage?: string } | null>(`*[_type == "lead" && _id == $id][0]{ stage }`, { id: leadId });
    if (!lead || (lead.stage && lead.stage !== "new")) return;
    await buyers
      .patch(leadId)
      .set({ stage: "lost", lostReason: SELLER_LOST_REASON })
      .setIfMissing({ notes: [] })
      .append("notes", [
        { _key: newKey(), at: new Date().toISOString(), kind: "system", text: "Selling or offering us something, not a buyer: the assistant asked them to email sales@lexington.com.gh and won't answer again." },
      ])
      .commit();
  } catch (error) {
    console.error("[chat] the seller's record wasn't updated:", error instanceof Error ? error.message : error);
  }
}

async function handoverTask(leadId: string | null | undefined, name: string, channel: ChatChannel, why: string): Promise<void> {
  if (!leadId) return;
  const now = new Date().toISOString();
  await getBuyersClient()
    .transaction()
    .patch(leadId, (p) => p.setIfMissing({ tasks: [] }))
    .patch(leadId, (p) =>
      p.append("tasks", [
        { _key: newKey(), text: `Reply to ${firstName(name)} on ${CHANNEL_NAMES[channel]}: ${why}`, due: todayISO(), waitingOn: "me", done: false, createdAt: now },
      ])
    )
    .commit()
    .catch((e: Error) => console.error("[chat] task not saved:", e.message));
}

// ---- writing the reply ------------------------------------------------------------------------------

interface Drafted {
  text: string;
  /** The residences to send as cards after the words. */
  cards: UnitFact[];
  handover: boolean;
  topic: HandoverTopic;
  reason: string;
  out: ChatOut | null;
  /** VAT on the prices, for the card pictures. */
  vat?: Vat;
  /** A free site-visit hour they said yes to: booked before the reply goes (lib/siteVisits). */
  book?: SlotKey | null;
  /** They sell or offer us something (SELLER_REPLY): the chat then goes quiet and their record leaves the pipeline. */
  seller?: boolean;
}

// Problems another go can fix: too long, or prices in its words that belong on the cards.
const STYLE_ONLY = /characters \(at most|quotes prices/;

async function draft(thread: ChatThread, nowMs: number): Promise<Drafted> {
  // The free site-visit hours of the next days: the assistant may offer and book only these.
  const free = await freeVisitSlots(nowMs, 8).catch(() => [] as SlotKey[]);
  const pack = { ...(await loadFactPack()), visits: { free, nowMs } };
  // What they said since the last reply (theirs may be several messages in a row).
  const lastOurs = thread.messages.map((m) => m.from !== "them").lastIndexOf(true);
  const latest = thread.messages.slice(lastOurs + 1).map((m) => m.text).join("\n");
  const theirWords = thread.messages.filter((m) => m.from === "them").map((m) => m.text).join("\n");
  const forced = handoverTopic(latest);

  let out: ChatOut | null = null;
  let text = "";
  let problems = ["No reply could be written."];
  if (claudeConfigured()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const again = attempt ? `\n\nYOUR LAST DRAFT: ${text}\nTO FIX: ${problems.join(" ")} Write it again: shorter, the figures left to the cards.` : "";
      const written = await writeWithClaude<ChatOut>({
        system: CHAT_SYSTEM(thread.channel),
        content: [{ type: "text", text: chatPrompt(factPackText(pack), thread) + again }],
        schema: CHAT_SCHEMA,
        effort: "low",
        maxTokens: 3000,
        purpose: "chat reply",
      });
      if (!written.ok) break;
      out = written.value;
      text = out.reply.trim();
      problems = [...chatProblems(text), ...factCheck(text, pack, theirWords)];
      if (!problems.length || !problems.every((p) => STYLE_ONLY.test(p))) break;
    }
  }
  // Someone selling us something: the one fixed answer, nothing else (no homes, no visit, no handover).
  if (out?.seller) return { text: SELLER_REPLY, cards: [], handover: false, topic: "none", reason: "", out, vat: pack.vat, book: null, seller: true };
  const loop = tooChatty(thread, nowMs);
  const topic: HandoverTopic = forced !== "none" ? forced : out?.handover ? out.topic === "none" ? "unknown" : out.topic : problems.length || loop ? "unknown" : "none";
  const handover = topic !== "none";
  if (problems.length || loop) text = holdingMessage(thread.name || out?.name);
  // A visit it booked must be one of the free hours it was given; otherwise it says which are free that day instead.
  let book: SlotKey | null = null;
  if (out?.visit_time?.trim() && !problems.length && !loop) {
    const slot = slotFromText(out.visit_time);
    if (slot && free.includes(slot)) book = slot;
    else text = notFreeText(slot, free);
  }
  if (!thread.messages.some((m) => m.from === "agent")) text = `${introLine()}\n\n${text}`;
  const reason = loop
    ? "a long run of messages in an hour"
    : problems.length
      ? `its reply needed checking (${problems.join("; ")})`
      : topic !== "none"
        ? HANDOVER_WORDS[topic as Exclude<HandoverTopic, "none">]
        : "";
  // Only with a reply that passed: a holding message goes alone.
  const cards =
    out && !problems.length && !loop
      ? pickCards(out.cards ?? [], pack.units)
          .map((n) => pack.units.find((u) => u.unitNumber === n))
          .filter((u): u is UnitFact => Boolean(u))
      : [];
  return { text, cards, handover, topic, reason, out, vat: pack.vat, book };
}

/** "That time isn't free": the free hours that day (or the next days), else the booking page. */
function notFreeText(slot: SlotKey | null, free: SlotKey[]): string {
  const day = slot ? slotDay(slot) : "";
  const sameDay = free.filter((k) => slotDay(k) === day);
  const later = free.filter((k) => !day || k > `${day}T23`);
  const pick = sameDay.length ? sameDay : later.filter((k) => slotDay(k) === slotDay(later[0] ?? ""));
  if (!pick.length) return `Sorry, that time isn't free. You can pick another time here: ${SITE_URL}/visit`;
  return `Sorry, ${slot ? slotLabel(slot) : "that time"} isn't free. On ${dayLabel(slotDay(pick[0]))} we can show you the site at ${pick.slice(0, 6).map(timeLabel).join(", ")}. Which suits you?`;
}

/**
 * Books the hour the assistant agreed with them (lib/siteVisits/store.ts: their record, Niko's alert, the day before a
 * reminder in this chat). Answers the words to send: the assistant's reply and the visit's details, or, when the hour
 * has just gone, the free ones instead. `failed` when it couldn't be booked at all (the chat then goes to Niko).
 */
async function bookFromChat(thread: ChatThread, d: Drafted): Promise<{ text: string; failed: boolean }> {
  const slot = d.book!;
  const out = d.out;
  const name = out?.name.trim() || thread.name?.trim() || `${CHANNEL_NAMES[thread.channel]} contact`;
  const phone = out?.phone.trim() || (thread.channel === "whatsapp" ? `+${thread.senderId}` : "");
  const email = out?.email.includes("@") ? out.email.trim() : "";
  const result = await bookVisit({
    slot,
    name,
    phone,
    email,
    people: null,
    interest: out?.interest.trim() ?? "",
    note: "",
    source: thread.channel,
    leadId: thread.leadId ?? null,
    threadId: thread._id,
  });
  if (result.ok) {
    return {
      text: `${d.text}\n\nBooked: ${dayLabel(slotDay(slot))}, ${rangeLabel(slot)} (Accra time). We are at ${VISIT_PLACE}: ${googleMapsUrl()}. If you need to change it, just reply here.`,
      failed: false,
    };
  }
  if (result.reason === "error") return { text: holdingMessage(name), failed: true };
  const alts = result.alternatives;
  const day = alts.length ? slotDay(alts[0]) : "";
  return {
    text: alts.length
      ? `Sorry, ${slotLabel(slot)} has just been taken. On ${dayLabel(day)} we can show you the site at ${alts.filter((k) => slotDay(k) === day).map(timeLabel).join(", ")}. Which suits you?`
      : `Sorry, ${slotLabel(slot)} has just been taken. You can pick another time here: ${SITE_URL}/visit`,
    failed: false,
  };
}

/** Alerts Niko about a chat (an alert in the site app that buzzes his phone), at most once an hour per chat. */
async function tellNiko(thread: ChatThread, subject: string, lines: string[], nowMs: number): Promise<boolean> {
  if (thread.notifiedAt && nowMs - Date.parse(thread.notifiedAt) < 3_600_000) return false;
  const where =
    thread.channel === "whatsapp" ? "Answer them in the WhatsApp Business app on your phone." : "Answer them in Business Suite or the Facebook / Instagram app.";
  return notifyOwner({
    kind: "chat",
    urgent: true,
    // One per chat on the lock screen: a newer alert about the same chat replaces the older one.
    tag: thread._id,
    title: subject,
    lines: [...lines, where],
    links: [
      ...(thread.channel === "whatsapp"
        ? []
        : [{ label: "Open Business Suite", url: `https://business.facebook.com/latest/inbox/${thread.channel === "instagram" ? "instagram_direct" : "messenger"}` }]),
      ...(thread.leadId ? [{ label: "Their record", url: `/admin/crm/${thread.leadId}` }] : []),
    ],
  });
}

// ---- one event ----------------------------------------------------------------------------------------

/** One message from Meta: a person's (answered when the agent may) or Niko's own. Never throws. */
export async function handleChatEvent(ev: ChatEvent, nowMs = Date.now()): Promise<void> {
  try {
    const id = threadIdFor(ev.channel, ev.senderId);
    const fresh = (): ChatThread => ({ _id: id, _type: "chatThread", channel: ev.channel, senderId: ev.senderId, messages: [] });

    if (ev.kind === "owner") {
      // The assistant's own messages, and Meta's automatic ones (the lead form's chat starter), aren't Niko taking over.
      if (ev.fromAgent || ev.automated) return;
      // The agent's own message can come back before it is saved: give that a moment, then look again.
      await sleep(3000);
      const saved = await updateThread(
        id,
        (t) => {
          if (t.messages.some((m) => m.mid === ev.mid || m.cardMids?.includes(ev.mid))) return null;
          // While the assistant is still sending its cards (its lock is on), a picture is one of them.
          if (t.lockedUntil && Date.parse(t.lockedUntil) > Date.now() && /^\[image/.test(ev.text)) return null;
          t.messages = keepLast([...t.messages, { _key: newKey(), from: "owner", text: ev.text.slice(0, 2000), at: ev.at, mid: ev.mid }]);
          t.ownerActiveUntil = new Date(Date.parse(ev.at) + OWNER_QUIET_HOURS * 3_600_000).toISOString();
          t.handedOver = null;
          return t;
        },
        fresh
      );
      if (saved?.leadId) await leadNote(saved.leadId, `${CHANNEL_NAMES[ev.channel]}, you: ${ev.text}`);
      return;
    }

    // A person's message: keep it (once), with their name when WhatsApp gives it.
    const kept = await updateThread(
      id,
      (t) => {
        if (t.messages.some((m) => m.mid === ev.mid)) return null;
        t.messages = keepLast([...t.messages, { _key: newKey(), from: "them", text: ev.text.slice(0, 2000), at: ev.at, mid: ev.mid }]);
        if (ev.name && !t.name) t.name = ev.name.slice(0, 120);
        if (wantsNoReplies(ev.text)) t.optedOut = true;
        return t;
      },
      fresh
    );
    if (!kept || !kept.messages.some((m) => m.mid === ev.mid)) return;
    let thread: ChatThread = kept;
    if (!thread.leadId) {
      const leadId = await ensureLead(thread);
      if (leadId) thread = (await updateThread(id, (t) => ({ ...t, leadId }), fresh)) ?? thread;
    }
    await leadNote(thread.leadId, `${CHANNEL_NAMES[ev.channel]}, ${thread.name ? firstName(thread.name) : "they"}: ${ev.text}`);

    const paused = !chatAgentOn() || (await readChatSwitch()).paused;
    const quiet = paused ? "The chat agent is paused." : quietReason(thread, nowMs);
    if (quiet) {
      // Waiting for Niko: make sure he knows there's more.
      if (!thread.optedOut && (thread.handedOver || paused)) {
        const name = thread.name || "someone";
        const sent = await tellNiko(thread, `${CHANNEL_NAMES[ev.channel]}: a new message from ${name}`, [`They wrote: "${ev.text}"`, quiet], nowMs);
        if (sent) await updateThread(id, (t) => ({ ...t, notifiedAt: new Date(nowMs).toISOString() }), fresh);
      }
      return;
    }

    // One reply at a time in each chat: a second delivery leaves it to the first, which looks again before it stops.
    const lockUntil = new Date(nowMs + 90_000).toISOString();
    let locked = false;
    await updateThread(
      id,
      (t) => {
        if (t.lockedUntil && Date.parse(t.lockedUntil) > Date.now()) return null;
        locked = true;
        return { ...t, lockedUntil: lockUntil };
      },
      fresh
    );
    if (!locked) return;

    try {
      for (let round = 0; round < 3; round += 1) {
        const current: ChatThread = (await readThread(id)) ?? thread;
        const seen = current.messages.length;
        const drafted = await draft(current, Date.now());
        const booking = drafted.book ? await bookFromChat(current, drafted) : null;
        const d: Drafted = booking
          ? {
              ...drafted,
              text: booking.text,
              handover: drafted.handover || booking.failed,
              reason: booking.failed ? "the visit they agreed couldn't be booked: book it by hand" : drafted.reason,
            }
          : drafted;
        let mid: string | null = null;
        let sendError: string | null = null;
        try {
          mid = await send(current, { text: d.text });
        } catch (error) {
          sendError = error instanceof Error ? error.message : "it couldn't be sent";
        }
        const now = new Date().toISOString();
        const key = newKey();
        thread =
          (await updateThread(
            id,
            (t) => {
              if (mid) t.messages = keepLast([...t.messages, { _key: key, from: "agent", text: d.text, at: now, mid }]);
              if (mid && d.seller) t.seller = now;
              if (d.handover || sendError) t.handedOver = { at: now, reason: sendError ? `the reply couldn't be sent (${sendError})` : d.reason };
              return t;
            },
            fresh
          )) ?? current;
        // Then the homes, as the website's cards; kept on the reply so their echoes are known as ours.
        const cards = mid ? await sendCards(current, d.cards, d.vat ?? NO_VAT) : [];
        if (cards.length) {
          thread =
            (await updateThread(
              id,
              (t) => {
                t.messages = t.messages.map((m) => (m._key === key ? { ...m, cards: cards.map((c) => c.unit), cardMids: cards.map((c) => c.mid) } : m));
                return t;
              },
              fresh
            )) ?? thread;
        }
        if (mid) await leadNote(thread.leadId, `${CHANNEL_NAMES[current.channel]}, assistant: ${d.text}${cards.length ? ` [cards: ${cards.map((c) => c.unit).join(", ")}]` : ""}`);
        if (d.out) {
          const joinedId = await learnAbout(thread.leadId, d.out, thread);
          if (joinedId && joinedId !== thread.leadId) thread = { ...thread, leadId: joinedId };
        }
        if (mid && d.seller) {
          await sellerOutOfPipeline(thread.leadId);
          break;
        }

        if (d.handover || sendError) {
          const name = thread.name || d.out?.name || "Someone";
          const why = sendError ? "the reply couldn't be sent" : d.reason;
          await handoverTask(thread.leadId, name, current.channel, why);
          const lastTheirs = [...current.messages].reverse().find((m) => m.from === "them")?.text ?? "";
          const sent = await tellNiko(
            thread,
            `${CHANNEL_NAMES[current.channel]}: ${name} ${sendError ? "needs an answer (the assistant's couldn't be sent)" : why}`,
            [`They wrote: "${lastTheirs}"`, ...(mid ? [`The assistant answered: "${d.text}"`] : [`Not answered: ${sendError}`])],
            Date.now()
          );
          if (sent) await updateThread(id, (t) => ({ ...t, notifiedAt: new Date().toISOString() }), fresh);
          break;
        }
        // Anything new from them while this was written? Answer that too.
        const after = await readThread(id);
        const newer = (after?.messages ?? []).slice(seen).some((m) => m.from === "them");
        if (!newer) break;
      }
    } finally {
      await updateThread(id, (t) => ({ ...t, lockedUntil: null }), fresh).catch(() => undefined);
    }
  } catch (error) {
    console.error("[chat] the message couldn't be handled:", error instanceof Error ? error.message : error);
  }
}

// ---- one follow-up when a chat goes quiet (the rules are in chatCore.ts) ------------------------------------

/**
 * Sends the site-visit follow-up to each chat that is due one, at most `max` a run (the agents' run calls this once an
 * hour). A chat gets one at most, ever: it is marked before the message goes. Never throws.
 */
export async function followUpQuietChats(nowMs = Date.now(), max = 5): Promise<{ sent: string[]; failed: string[] }> {
  const done = { sent: [] as string[], failed: [] as string[] };
  if (!chatAgentOn()) return done;
  try {
    // One read: the pause switch, the chats the assistant answered in the last 20 hours, and who has a visit.
    const since = new Date(nowMs - FOLLOW_UP_BEFORE_HOURS * 3_600_000).toISOString();
    const data = await getBuyersClient().fetch<{ paused: boolean | null; threads: ChatThread[]; visits: Array<{ threadId?: string; leadId?: string }> }>(
      `{
        "paused": *[_id == $switchId][0].paused,
        "threads": *[_type == "chatThread" && string::startsWith(_id, $prefix) && !defined(followedUpAt) && optedOut != true && messages[-1].from == "agent" && messages[-1].at > $since],
        "visits": *[_type == "siteVisit" && string::startsWith(_id, $vp)]{ threadId, leadId }
      }`,
      { switchId: SWITCH_ID, prefix: `${PROD ? "chat" : "chat-dev"}.`, since, vp: VISIT_PREFIX }
    );
    if (data.paused) return done;
    const booked = new Set(data.visits.flatMap((v) => [v.threadId, v.leadId]).filter((x): x is string => Boolean(x)));
    const due = data.threads.filter((t) => followUpDue(t, nowMs, booked.has(t._id) || Boolean(t.leadId && booked.has(t.leadId)))).slice(0, max);
    if (!due.length) return done;
    const free = await freeVisitSlots(nowMs, 8).catch(() => [] as SlotKey[]);
    const times = twoFreeTimes(free, nowMs).map((k) => slotLabel(k));
    for (const thread of due) {
      const text = followUpText({ first: followUpFirstName(thread), abroad: livesAbroad(thread), times, link: `${SITE_URL}/visit` });
      // Marked first, so no later run can send it again.
      let claimed = false;
      await updateThread(
        thread._id,
        (t) => {
          if (!followUpDue(t, nowMs, false)) return null;
          claimed = true;
          return { ...t, followedUpAt: new Date(nowMs).toISOString() };
        },
        () => thread
      );
      if (!claimed) continue;
      try {
        const mid = await send(thread, { text });
        const at = new Date().toISOString();
        await updateThread(thread._id, (t) => ({ ...t, messages: keepLast([...t.messages, { _key: newKey(), from: "agent", text, at, mid }]) }), () => thread);
        await leadNote(thread.leadId, `${CHANNEL_NAMES[thread.channel]}, assistant (follow-up): ${text}`);
        done.sent.push(thread._id);
      } catch (error) {
        console.error(`[chat] the follow-up to ${thread._id} couldn't be sent:`, error instanceof Error ? error.message : error);
        done.failed.push(thread._id);
      }
    }
  } catch (error) {
    console.error("[chat] the follow-ups failed:", error instanceof Error ? error.message : error);
  }
  return done;
}

// ---- for the Connect page and the daily check ---------------------------------------------------------

/** Lets the Page's Messenger (and the Instagram account linked to it) send its messages to the website. */
export async function connectPage(): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await pageAccess();
  if (!access) return { ok: false, error: "The Facebook Page key isn't set (META_LEADS_TOKEN)." };
  const response = await fetch(`${access.base}/${access.pageId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ subscribed_fields: "messages,message_echoes,messaging_postbacks" }).toString(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const out = (await response.json().catch(() => null)) as { success?: boolean; error?: { message?: string } } | null;
  if (!response.ok || out?.error || !out?.success) return { ok: false, error: out?.error?.message ?? `Meta answered ${response.status}` };
  return { ok: true };
}

export interface ChatSummary {
  /** Chats with a message from someone in the last 24 hours. */
  active: number;
  /** Chats handed over and not answered by Niko yet. */
  waiting: Array<{ name: string; channel: ChatChannel; hours: number; reason: string }>;
  lastAt: string | null;
}

export async function chatSummary(nowMs = Date.now()): Promise<ChatSummary> {
  const threads = await getBuyersClient().fetch<ChatThread[]>(
    `*[_type == "chatThread" && string::startsWith(_id, $prefix)] | order(_updatedAt desc)[0...200]{ _id, channel, senderId, name, handedOver, "messages": messages[-6..-1] }`,
    { prefix: `${PROD ? "chat" : "chat-dev"}.` }
  );
  const dayAgo = nowMs - 86_400_000;
  let lastAt: string | null = null;
  let active = 0;
  const waiting: ChatSummary["waiting"] = [];
  for (const t of threads) {
    const theirs = (t.messages ?? []).filter((m) => m.from === "them");
    const last = theirs[theirs.length - 1]?.at ?? null;
    if (last && (!lastAt || last > lastAt)) lastAt = last;
    if (last && Date.parse(last) > dayAgo) active += 1;
    if (t.handedOver) {
      const ownerAfter = (t.messages ?? []).some((m) => m.from === "owner" && m.at > t.handedOver!.at);
      if (!ownerAfter)
        waiting.push({
          name: t.name || `someone on ${CHANNEL_NAMES[t.channel]}`,
          channel: t.channel,
          hours: Math.round((nowMs - Date.parse(t.handedOver.at)) / 3_600_000),
          reason: t.handedOver.reason,
        });
    }
  }
  return { active, waiting: waiting.sort((a, b) => b.hours - a.hours), lastAt };
}
