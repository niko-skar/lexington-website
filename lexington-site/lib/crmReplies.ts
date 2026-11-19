import "server-only";
import { randomBytes } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import type { LeadTask } from "@/lib/sanity/crmTypes";

// A first reply that went out somewhere the CRM can see closes the prospect's "Reply to ..." step by itself (Niko,
// 19 Nov 2026: the daily check said "30 enquiries still waiting for a first reply" when "each one of them has been
// answered by me or you"). Until then only the suggested reply's "I sent it" button closed it, so every enquiry the
// chat assistant answered in Messenger or Instagram, or that Niko answered there himself, stayed "waiting".

export type ReplyChannel = "messenger" | "instagram" | "whatsapp";
const CHANNEL: Record<ReplyChannel, string> = { messenger: "Messenger", instagram: "Instagram", whatsapp: "WhatsApp" };
const newKey = () => randomBytes(6).toString("hex");

/**
 * A step asking for the first reply to an enquiry ("Reply to Ama (Facebook lead form)", "Reply to Ama's enquiry"), not
 * one the chat assistant handed over ("Reply to Ama on Instagram: wants a better price"): that one needs Niko himself.
 */
export function isFirstReplyStep(text: string | undefined): boolean {
  return /^reply to\b/i.test(text ?? "") && !/^reply to .+ on (messenger|instagram|whatsapp)\b/i.test(text ?? "");
}
/** A step the assistant handed over to Niko in this channel. */
function isHandoverStep(text: string | undefined, channel: ReplyChannel): boolean {
  return new RegExp(`^reply to .+ on ${CHANNEL[channel]}\\b`, "i").test(text ?? "");
}

type ReplyLead = { stage?: string; replyWanted?: boolean; draft?: string | null; tasks?: LeadTask[] | null };

/**
 * A reply went out in the prospect's chat: the assistant's (it closes the first-reply step) or Niko's own from the Page
 * (it closes the first-reply step and anything the assistant handed over in that chat). A suggested reply still waiting
 * is marked as sent there, a new prospect moves to Contacted, and the record says so once. Does nothing when there is
 * nothing open; never throws. Answers whether it changed anything.
 */
export async function answeredInChat(leadId: string | null | undefined, channel: ReplyChannel, by: "assistant" | "you", text = ""): Promise<boolean> {
  if (!leadId) return false;
  try {
    const buyers = getBuyersClient();
    const lead = await buyers.fetch<ReplyLead | null>(`*[_type == "lead" && _id == $id][0]{ stage, replyWanted, "draft": replyDraft.status, tasks }`, { id: leadId });
    if (!lead) return false;
    const steps = (lead.tasks ?? []).filter((t) => !t.done && (isFirstReplyStep(t.text) || (by === "you" && isHandoverStep(t.text, channel))));
    const isNew = (lead.stage ?? "new") === "new";
    const draftWaiting = lead.draft === "draft";
    if (!steps.length && !isNew && !draftWaiting && !lead.replyWanted) return false;

    const now = new Date().toISOString();
    const how = `${by === "assistant" ? "by the assistant" : "by you"} in their ${CHANNEL[channel]} chat`;
    const ticked = steps.length ? ` Ticked: ${steps.map((s) => `"${s.text}"`).join(", ")}.` : "";
    // Only a reply to something handed over (the first reply went out before): "answered", not "first reply".
    const first = isNew || draftWaiting || Boolean(lead.replyWanted) || steps.some((s) => isFirstReplyStep(s.text));
    await buyers
      .transaction()
      .patch(leadId, (p) => p.setIfMissing({ notes: [] }))
      .patch(leadId, (p) => {
        let next = p.set({ replyWanted: false });
        for (const s of steps) next = next.set({ [`tasks[_key=="${s._key}"].done`]: true, [`tasks[_key=="${s._key}"].doneAt`]: now });
        if (isNew) next = next.set({ stage: "contacted" });
        if (draftWaiting) {
          next = next.set({
            "replyDraft.status": "sent",
            "replyDraft.sentAt": now,
            "replyDraft.sentVia": channel,
            ...(text ? { "replyDraft.subject": "", "replyDraft.body": text.slice(0, 3000) } : {}),
          });
        }
        return next;
      })
      // One append per patch: two on the same patch overwrite each other.
      .patch(leadId, (p) => p.append("notes", [{ _key: newKey(), at: now, kind: "system", text: `${first ? "First reply sent" : "Answered"} ${how}.${ticked}`.slice(0, 3000) }]))
      .commit();
    return true;
  } catch (error) {
    console.error("[crm] couldn't mark the first reply:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * The person's chat with the assistant already has a reply of ours (a lead form entry often arrives a few minutes after
 * its Messenger chat began, and the assistant has answered by then): the prospect is answered. `psid` is the person's
 * Messenger id from the form entry's chat link, for a chat not tied to the prospect yet. Never throws.
 */
export async function closeIfChatAnswered(leadId: string, psid?: string): Promise<boolean> {
  try {
    const thread = await getBuyersClient().fetch<{ channel?: ReplyChannel; ours?: { from?: string; text?: string } | null } | null>(
      `*[_type == "chatThread" && (_id == *[_type == "lead" && _id == $id][0].chatThread || ($psid != "" && senderId == $psid))][0]{
        channel, "ours": messages[from in ["agent", "owner"]][0]{ from, text }
      }`,
      { id: leadId, psid: psid ?? "" }
    );
    if (!thread?.ours || !thread.channel) return false;
    return answeredInChat(leadId, thread.channel, thread.ours.from === "owner" ? "you" : "assistant", thread.ours.text ?? "");
  } catch {
    return false;
  }
}

/**
 * "Put this reply aside (I answered another way)" on the suggested reply: Niko answered elsewhere (WhatsApp, a call),
 * so the first-reply step closes too and a new prospect moves to Contacted (it used to stay "waiting").
 */
export async function answeredAnotherWay(leadId: string): Promise<void> {
  const buyers = getBuyersClient();
  const lead = await buyers.fetch<ReplyLead | null>(`*[_type == "lead" && _id == $id][0]{ stage, tasks }`, { id: leadId });
  const steps = (lead?.tasks ?? []).filter((t) => !t.done && isFirstReplyStep(t.text));
  const isNew = (lead?.stage ?? "new") === "new";
  const now = new Date().toISOString();
  await buyers
    .transaction()
    .patch(leadId, (p) => p.setIfMissing({ notes: [] }))
    .patch(leadId, (p) => {
      let next = p.set({ "replyDraft.status": "discarded", replyWanted: false });
      for (const s of steps) next = next.set({ [`tasks[_key=="${s._key}"].done`]: true, [`tasks[_key=="${s._key}"].doneAt`]: now });
      if (isNew) next = next.set({ stage: "contacted" });
      return next;
    })
    .patch(leadId, (p) => p.append("notes", [{ _key: newKey(), at: now, kind: "system", text: "First reply sent another way (the suggested reply was put aside)." }]))
    .commit();
}
