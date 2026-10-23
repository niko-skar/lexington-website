import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { claudeConfigured, writeWithClaude } from "@/lib/ai/claude";
import { firstName, todayISO } from "@/lib/crm";
import { internationalDigits } from "@/lib/format";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { SITE_URL } from "@/lib/seo";
import { sendNotice } from "@/lib/social/notify";

import {
  AGENT_METADATA,
  CHANNEL_NAMES,
  CHAT_SCHEMA,
  CHAT_SYSTEM,
  HANDOVER_WORDS,
  OWNER_QUIET_HOURS,
  chatProblems,
  chatPrompt,
  handoverTopic,
  holdingMessage,
  introLine,
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
import { factPackText } from "./factsCore";
import { pageAccess } from "./metaLeads";

/**
 * THE CHAT AGENT (Niko, 23 Oct 2026: "get the ai agents to respond to my facebook and whatsapp
 * messages for me"; it answers by itself and hands the hard ones to him). Meta sends every new
 * message on the Page's Messenger, on Instagram and on WhatsApp to /api/meta/webhook; for each one
 * this answers from the website's facts (the rules are in chatCore.ts), keeps the chat in one
 * private document per person (`chat.<channel>.<id>`), puts the person in Prospects with the chat
 * in their timeline, and emails Niko when it hands a chat over. When he answers himself (in
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

/** Sends one message on the chat's channel and returns its id. Throws in Meta's words. */
async function send(thread: ChatThread, text: string): Promise<string> {
  let url: string;
  let token: string;
  let body: Record<string, unknown>;
  if (thread.channel === "whatsapp") {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const waToken = process.env.WHATSAPP_TOKEN?.trim();
    if (!phoneId || !waToken) throw new Error("WhatsApp isn't connected yet (WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN).");
    url = `${graphBase()}/${phoneId}/messages`;
    token = waToken;
    body = { messaging_product: "whatsapp", recipient_type: "individual", to: thread.senderId, type: "text", text: { body: text, preview_url: true } };
  } else {
    const access = await pageAccess();
    if (!access) throw new Error("The Facebook Page isn't connected (META_PAGE_ID and the Page key).");
    url = `${access.base}/${access.pageId}/messages`;
    token = access.token;
    body = { recipient: { id: thread.senderId }, messaging_type: "RESPONSE", message: { text, metadata: AGENT_METADATA } };
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

const PLACEHOLDER = / contact$/;

async function ensureLead(thread: ChatThread): Promise<string | null> {
  if (thread.leadId) return thread.leadId;
  const buyers = getBuyersClient();
  try {
    // On WhatsApp the number says who it is: the same person already in Prospects keeps their record.
    if (thread.channel === "whatsapp") {
      const digits = internationalDigits(`+${thread.senderId}`).replace(/\D/g, "");
      const withPhones = await buyers.fetch<Array<{ _id: string; phone: string }>>(`*[_type == "lead" && defined(phone)]{ _id, phone }`);
      const same = withPhones.find((l) => internationalDigits(l.phone).replace(/\D/g, "") === digits);
      if (same) return same._id;
    }
    const now = new Date().toISOString();
    const doc = await buyers.create({
      _type: "lead",
      name: thread.name?.trim() || `${CHANNEL_NAMES[thread.channel]} contact`,
      ...(thread.channel === "whatsapp" && { phone: `+${thread.senderId}` }),
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

async function leadNote(leadId: string | null | undefined, text: string): Promise<void> {
  if (!leadId) return;
  await getBuyersClient()
    .transaction()
    .patch(leadId, (p) => p.setIfMissing({ notes: [] }))
    .patch(leadId, (p) => p.append("notes", [{ _key: newKey(), at: new Date().toISOString(), kind: "system", text: text.slice(0, 3000) }]))
    .commit()
    .catch((e: Error) => console.error("[chat] note not saved:", e.message));
}

/** What the person said about themselves, onto their record (a name replaces only the placeholder). */
async function learnAbout(leadId: string | null | undefined, out: ChatOut): Promise<void> {
  if (!leadId) return;
  const buyers = getBuyersClient();
  const lead = await buyers.fetch<{ name?: string; email?: string; phone?: string; interest?: string } | null>(
    `*[_type == "lead" && _id == $id][0]{ name, email, phone, interest }`,
    { id: leadId }
  );
  if (!lead) return;
  const set: Record<string, string> = {};
  if (out.name.trim() && (!lead.name || PLACEHOLDER.test(lead.name))) set.name = out.name.trim().slice(0, 120);
  if (out.email.includes("@") && !lead.email) set.email = out.email.trim().toLowerCase().slice(0, 160);
  if (out.phone.replace(/\D/g, "").length >= 9 && !lead.phone) set.phone = out.phone.trim().slice(0, 40);
  if (out.interest.trim() && !lead.interest) set.interest = out.interest.trim().slice(0, 120);
  if (Object.keys(set).length) await buyers.patch(leadId).set(set).commit().catch(() => undefined);
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
  handover: boolean;
  topic: HandoverTopic;
  reason: string;
  out: ChatOut | null;
}

async function draft(thread: ChatThread, nowMs: number): Promise<Drafted> {
  const pack = await loadFactPack();
  // What they said since the last reply (theirs may be several messages in a row).
  const lastOurs = thread.messages.map((m) => m.from !== "them").lastIndexOf(true);
  const latest = thread.messages.slice(lastOurs + 1).map((m) => m.text).join("\n");
  const theirWords = thread.messages.filter((m) => m.from === "them").map((m) => m.text).join("\n");
  const forced = handoverTopic(latest);

  let out: ChatOut | null = null;
  if (claudeConfigured()) {
    const written = await writeWithClaude<ChatOut>({
      system: CHAT_SYSTEM(thread.channel),
      content: [{ type: "text", text: chatPrompt(factPackText(pack), thread) }],
      schema: CHAT_SCHEMA,
      effort: "low",
      maxTokens: 3000,
      purpose: "chat reply",
    });
    if (written.ok) out = written.value;
  }
  let text = out?.reply.trim() ?? "";
  const problems = out ? [...chatProblems(text), ...factCheck(text, pack, theirWords)] : ["No reply could be written."];
  const loop = tooChatty(thread, nowMs);
  const topic: HandoverTopic = forced !== "none" ? forced : out?.handover ? out.topic === "none" ? "unknown" : out.topic : problems.length || loop ? "unknown" : "none";
  const handover = topic !== "none";
  if (problems.length || loop) text = holdingMessage(thread.name || out?.name);
  if (!thread.messages.some((m) => m.from === "agent")) text = `${introLine(thread.channel)}\n\n${text}`;
  const reason = loop
    ? "a long run of messages in an hour"
    : problems.length
      ? `its reply needed checking (${problems.join("; ")})`
      : topic !== "none"
        ? HANDOVER_WORDS[topic as Exclude<HandoverTopic, "none">]
        : "";
  return { text, handover, topic, reason, out };
}

/** Emails Niko about a chat, at most once an hour per chat. */
async function tellNiko(thread: ChatThread, subject: string, lines: string[], nowMs: number): Promise<boolean> {
  if (thread.notifiedAt && nowMs - Date.parse(thread.notifiedAt) < 3_600_000) return false;
  const where =
    thread.channel === "whatsapp"
      ? "Answer them in the WhatsApp Business app on your phone."
      : `Answer them in Business Suite: https://business.facebook.com/latest/inbox/${thread.channel === "instagram" ? "instagram_direct" : "messenger"}`;
  return sendNotice(subject, [...lines, where, ...(thread.leadId ? [`Their record: ${SITE_URL}/admin/crm/${thread.leadId}`] : [])]);
}

// ---- one event ----------------------------------------------------------------------------------------

/** One message from Meta: a person's (answered when the agent may) or Niko's own. Never throws. */
export async function handleChatEvent(ev: ChatEvent, nowMs = Date.now()): Promise<void> {
  try {
    const id = threadIdFor(ev.channel, ev.senderId);
    const fresh = (): ChatThread => ({ _id: id, _type: "chatThread", channel: ev.channel, senderId: ev.senderId, messages: [] });

    if (ev.kind === "owner") {
      if (ev.fromAgent) return;
      // The agent's own message can come back before it is saved: give that a moment, then look again.
      await sleep(3000);
      const saved = await updateThread(
        id,
        (t) => {
          if (t.messages.some((m) => m.mid === ev.mid)) return null;
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
        const d = await draft(current, Date.now());
        let mid: string | null = null;
        let sendError: string | null = null;
        try {
          mid = await send(current, d.text);
        } catch (error) {
          sendError = error instanceof Error ? error.message : "it couldn't be sent";
        }
        const now = new Date().toISOString();
        thread =
          (await updateThread(
            id,
            (t) => {
              if (mid) t.messages = keepLast([...t.messages, { _key: newKey(), from: "agent", text: d.text, at: now, mid }]);
              if (d.handover || sendError) t.handedOver = { at: now, reason: sendError ? `the reply couldn't be sent (${sendError})` : d.reason };
              return t;
            },
            fresh
          )) ?? current;
        if (mid) await leadNote(thread.leadId, `${CHANNEL_NAMES[current.channel]}, assistant: ${d.text}`);
        if (d.out) await learnAbout(thread.leadId, d.out);

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
