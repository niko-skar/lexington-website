import "server-only";

import { randomUUID } from "node:crypto";

import { Resend } from "resend";

import { claudeConfigured, writeWithClaude } from "@/lib/ai/claude";
import { addDaysISO, firstName, todayISO } from "@/lib/crm";
import { personalEmailHtml } from "@/lib/email/templates";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { client } from "@/lib/sanity/client";
import type { Lead, ReplyDraft } from "@/lib/sanity/crmTypes";

import { loadFactPack } from "./facts";
import { factCheck } from "./factcheck";
import {
  LEAD_REPLY_SCHEMA,
  LEAD_REPLY_SYSTEM,
  detectWanted,
  leadPrompt,
  pickUnits,
  templateReply,
  type LeadChannel,
  type LeadContext,
  type LeadReplyOut,
} from "./leadReplyCore";

/**
 * THE LEAD RESPONDER. When someone enquires (the website form, a Facebook or
 * Instagram lead form), it writes a first reply within a minute or so, from the
 * live unit list and the current offer only, and puts it on the prospect's page
 * in the CRM as "Suggested reply": Niko reads it, changes what he likes, and
 * presses Send email (or opens it in WhatsApp). Every suggested reply has been
 * through the fact check; what it found is shown as "check before sending".
 *
 * Sending by itself, without Niko, happens only when LEAD_AUTO_REPLY=1 is set,
 * and even then only for a reply the fact check passed, to someone with an email
 * address who doesn't look like spam.
 */

const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12);

const LEAD_FIELDS = `{ _id, _createdAt, name, email, phone, source, stage, interest, unitNumber, tasks, notes, replyWanted, replyDraft, formAnswers }`;

function channelOf(source: string | undefined): LeadChannel {
  if (source === "website") return "website";
  if (source === "meta_ads") return "facebook";
  return "manual";
}

function contextOf(lead: Lead, message?: string): LeadContext {
  const history = [...(lead.notes ?? [])]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-6)
    .map((n) => `${n.at.slice(0, 10)}: ${n.text.slice(0, 700)}`);
  return {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    channel: channelOf(lead.source),
    interest: lead.interest,
    unitNumber: lead.unitNumber,
    message: message?.trim() || undefined,
    answers: lead.formAnswers?.map((a) => ({ question: a.question, answer: a.answer })),
    history,
  };
}

/**
 * Writes a suggested reply for one prospect and saves it on them. `message` is what
 * they wrote, when it is known on its own (their timeline is used either way).
 * Returns the draft, or null when the prospect can't be found. Never throws.
 */
export async function draftReply(leadId: string, opts: { message?: string } = {}): Promise<ReplyDraft | null> {
  try {
    const buyers = getBuyersClient();
    const lead = await buyers.fetch<Lead | null>(`*[_type == "lead" && _id == $id][0]${LEAD_FIELDS}`, { id: leadId });
    if (!lead) return null;

    const pack = await loadFactPack();
    const ctx = contextOf(lead, opts.message);
    const picks = pickUnits(pack, detectWanted(ctx, pack));

    let draft: ReplyDraft;
    let note: string | undefined;
    const written = claudeConfigured()
      ? await writeWithClaude<LeadReplyOut>({
          system: LEAD_REPLY_SYSTEM,
          content: [{ type: "text", text: leadPrompt(pack, ctx, picks) }],
          schema: LEAD_REPLY_SCHEMA,
          effort: "medium",
          purpose: "lead reply",
        })
      : null;

    if (written?.ok && written.value.email_body.trim()) {
      const out = written.value;
      draft = {
        createdAt: new Date().toISOString(),
        writer: "claude",
        subject: out.email_subject.trim().slice(0, 160),
        body: out.email_body.trim().slice(0, 6000),
        whatsapp: out.whatsapp_text.trim().slice(0, 1500),
        temperature: out.temperature,
        temperatureReason: out.temperature_reason.trim().slice(0, 300),
        warnings: out.needs_owner.filter((q) => q.trim()).map((q) => `Only you can answer: ${q.trim()}`),
        units: picks.map((u) => u.unitNumber),
        status: "draft",
      };
    } else {
      if (written && !written.ok) note = `Claude couldn't write this one (${written.error.replace(/\.$/, "")}), so this is the standard reply.`;
      const plain = templateReply(ctx, pack, picks);
      draft = {
        createdAt: new Date().toISOString(),
        writer: "template",
        ...plain,
        warnings: [],
        units: picks.map((u) => u.unitNumber),
        status: "draft",
        ...(note && { note }),
      };
    }

    // The fact check runs on what will actually be sent, whoever wrote it.
    const checked = factCheck(`${draft.subject}\n${draft.body}\n${draft.whatsapp}`, pack);
    draft.warnings = [...checked, ...draft.warnings];
    if (!lead.email && !lead.phone) draft.warnings.push("They left no email or phone number.");

    await buyers.patch(lead._id).set({ replyDraft: draft }).commit();
    return draft;
  } catch (error) {
    console.error("[lead responder] could not write a reply:", error instanceof Error ? error.message : error);
    return null;
  }
}

// ---- sending ------------------------------------------------------------------

export type SendResult = { ok: true } | { ok: false; error: string };

/** Sends the reply by email from the sales address. Never throws. */
export async function sendReplyEmail(lead: Pick<Lead, "email" | "name">, subject: string, body: string): Promise<SendResult> {
  if (!lead.email) return { ok: false, error: `${lead.name} has no email address.` };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "Email sending is not set up (RESEND_API_KEY)." };
  try {
    const settings = await client.fetch<{ contactEmail?: string } | null>(`*[_type == "siteSettings"][0]{ contactEmail }`);
    const result = await new Resend(apiKey).emails.send({
      from: "The Lexington <sales@lexington.com.gh>",
      to: lead.email,
      replyTo: settings?.contactEmail || "sales@lexington.com.gh",
      subject,
      html: personalEmailHtml(body),
      text: body,
    });
    // Resend reports a refused email in `error` rather than by throwing.
    if (result.error) return { ok: false, error: `The email was refused: ${result.error.message}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The email could not be sent." };
  }
}

/**
 * The CRM side of a sent reply: the draft is marked sent (with what was really
 * sent), the "Reply to ..." step is ticked off, a new prospect moves to
 * Contacted, and a "waiting on them" step follows in three days.
 */
export async function recordReplySent(
  leadId: string,
  sent: { subject: string; body: string; via: "email" | "whatsapp" | "auto-email" }
): Promise<void> {
  const buyers = getBuyersClient();
  const lead = await buyers.fetch<Lead | null>(`*[_type == "lead" && _id == $id][0]${LEAD_FIELDS}`, { id: leadId });
  if (!lead) throw new Error("Prospect not found.");

  const now = new Date().toISOString();
  const replySteps = (lead.tasks ?? []).filter((t) => !t.done && /^reply to\b/i.test(t.text));
  const how = sent.via === "whatsapp" ? "on WhatsApp" : sent.via === "auto-email" ? "by email, automatically" : "by email";
  const followUp = {
    _key: newKey(),
    text: `Waiting for ${firstName(lead.name)} to answer our first reply`,
    due: addDaysISO(todayISO(), 3),
    waitingOn: "them",
    done: false,
    createdAt: now,
  };

  let tx = buyers
    .transaction()
    .patch(leadId, (p) => p.setIfMissing({ tasks: [], notes: [] }))
    .patch(leadId, (p) => {
      let next = p.set({
        "replyDraft.status": "sent",
        "replyDraft.sentAt": now,
        "replyDraft.sentVia": sent.via,
        "replyDraft.subject": sent.subject,
        "replyDraft.body": sent.body,
        replyWanted: false,
      });
      for (const t of replySteps) next = next.set({ [`tasks[_key=="${t._key}"].done`]: true, [`tasks[_key=="${t._key}"].doneAt`]: now });
      if ((lead.stage ?? "new") === "new") next = next.set({ stage: "contacted" });
      return next;
    })
    // One append per patch: two on the same patch overwrite each other.
    .patch(leadId, (p) =>
      p.append("notes", [
        {
          _key: newKey(),
          at: now,
          kind: "system",
          text: `First reply sent ${how}${sent.via === "whatsapp" ? "" : `: "${sent.subject}"`}`,
        },
      ])
    );
  if ((lead.stage ?? "new") === "new") {
    tx = tx.patch(leadId, (p) => p.append("notes", [{ _key: newKey(), at: now, kind: "stage", text: "Moved: New enquiry → Contacted" }]));
  }
  tx = tx.patch(leadId, (p) => p.append("tasks", [followUp]));
  await tx.commit();
}

/** Puts the suggested reply aside (Niko answered some other way). */
export async function discardReply(leadId: string): Promise<void> {
  await getBuyersClient().patch(leadId).set({ "replyDraft.status": "discarded", replyWanted: false }).commit();
}

// ---- the automatic part ---------------------------------------------------------

export function autoReplyOn(): boolean {
  return process.env.LEAD_AUTO_REPLY === "1";
}

/**
 * A new enquiry has just been saved: write the suggested reply, and send it by itself
 * only when automatic replies are switched on and nothing needs checking. Never throws.
 */
export async function respondToNewLead(leadId: string, opts: { message?: string } = {}): Promise<ReplyDraft | null> {
  const draft = await draftReply(leadId, opts);
  if (!draft || !autoReplyOn()) return draft;
  if (draft.warnings.length || draft.temperature === "cold" || draft.writer !== "claude") return draft;
  try {
    const lead = await getBuyersClient().fetch<Pick<Lead, "email" | "name"> | null>(`*[_type == "lead" && _id == $id][0]{ email, name }`, {
      id: leadId,
    });
    if (!lead?.email) return draft;
    const sent = await sendReplyEmail(lead, draft.subject, draft.body);
    if (sent.ok) {
      await recordReplySent(leadId, { subject: draft.subject, body: draft.body, via: "auto-email" });
      return { ...draft, status: "sent", sentVia: "auto-email" };
    }
    console.error("[lead responder] automatic reply not sent:", sent.error);
  } catch (error) {
    console.error("[lead responder] automatic reply failed:", error instanceof Error ? error.message : error);
  }
  return draft;
}

/**
 * The safety net, run by the every-10-minutes job: any recent enquiry that should
 * have a suggested reply but has none (the first try failed, or it came in some
 * other way) gets one now. A few per run, oldest first.
 */
export async function draftMissingReplies(max = 3): Promise<string[]> {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const waiting = await getBuyersClient().fetch<Array<{ _id: string }>>(
    `*[_type == "lead" && replyWanted == true && !defined(replyDraft) && _createdAt > $since] | order(_createdAt asc)[0...$max]{ _id }`,
    { since, max }
  );
  const done: string[] = [];
  for (const { _id } of waiting) {
    const draft = await respondToNewLead(_id);
    if (draft) done.push(_id);
  }
  return done;
}
