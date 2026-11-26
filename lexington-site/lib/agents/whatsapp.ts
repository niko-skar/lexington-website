import "server-only";

import { randomUUID } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";

import { graphBase, startWhatsAppThread, threadIdFor } from "./chat";
import {
  DEFAULT_TEMPLATE,
  DEFAULT_TEMPLATE_LANG,
  FIRST_WITHIN_HOURS,
  MAX_ATTEMPTS,
  daytimeFor,
  failureWords,
  greetingName,
  mayWhatsAppFirst,
  templateRequest,
  templateWords,
  whatsAppModeOf,
  whatsAppNumber,
  whereTheyLive,
  type FirstWhatsAppLead,
  type WhatsAppStatus,
} from "./whatsappCore";

/**
 * THE FIRST WHATSAPP (Niko, 26 Nov 2026: "we can do the api ourselves ... just have to go out an get a new sim"). The
 * Lexington's own number runs on Meta's WhatsApp Cloud API. Every ten minutes (/api/cron/agents), a Facebook / Instagram
 * lead form entry from the last three days whose email reply has been decided gets one WhatsApp, the template Meta
 * approved ("Hi Ama, thank you for your enquiry about The Lexington ..."), in their daytime. When they answer, the chat
 * assistant takes over as on Messenger (lib/agents/chat.ts), and Niko or the team can type in the WhatsApp box on their
 * record. The rules are in whatsappCore.ts.
 *
 * On with WHATSAPP_FIRST_MESSAGE=on, once WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN are set. WHATSAPP_TEMPLATE and
 * WHATSAPP_TEMPLATE_LANG name the template (default lexington_enquiry_reply, en). The words it says are kept in
 * templateWords(): they must stay the same as the template's in WhatsApp Manager.
 */

const newKey = () => randomUUID().replace(/-/g, "").slice(0, 12);

export function whatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() && process.env.WHATSAPP_TOKEN?.trim());
}

export function firstWhatsAppOn(): boolean {
  return whatsAppModeOf(process.env.WHATSAPP_FIRST_MESSAGE) === "on" && whatsAppConfigured();
}

const template = () => process.env.WHATSAPP_TEMPLATE?.trim() || DEFAULT_TEMPLATE;
const templateLang = () => process.env.WHATSAPP_TEMPLATE_LANG?.trim() || DEFAULT_TEMPLATE_LANG;

type SendResult = { ok: true; mid: string } | { ok: false; error: string; passing: boolean };

/** Sends the approved template to one number. A passing failure (Meta busy, no connection) may be tried again. */
export async function sendFirstTemplate(to: string, name: string | null | undefined): Promise<SendResult & { words: string }> {
  const first = greetingName(name);
  const words = templateWords(first);
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const token = process.env.WHATSAPP_TOKEN?.trim();
  if (!phoneId || !token) return { ok: false, error: "WhatsApp isn't connected yet (WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN).", passing: false, words };
  try {
    const response = await fetch(`${graphBase()}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(templateRequest(to, template(), templateLang(), first)),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const out = (await response.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    } | null;
    const mid = out?.messages?.[0]?.id;
    if (response.ok && mid) return { ok: true, mid, words };
    const e = out?.error;
    const error = [e?.code ? `(${e.code})` : "", e?.message ?? `Meta answered ${response.status}`, e?.error_data?.details ?? ""].filter(Boolean).join(" ");
    return { ok: false, error, passing: response.status >= 500 || response.status === 429, words };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "no connection", passing: true, words };
  }
}

async function note(leadId: string, text: string): Promise<void> {
  await getBuyersClient()
    .transaction()
    .patch(leadId, (p) => p.setIfMissing({ notes: [] }))
    .patch(leadId, (p) => p.append("notes", [{ _key: newKey(), at: new Date().toISOString(), kind: "system", text: text.slice(0, 3000) }]))
    .commit()
    .catch((e: Error) => console.error("[whatsapp] note not saved:", e.message));
}

type Candidate = FirstWhatsAppLead & {
  _id: string;
  _rev: string;
  name?: string;
  formAnswers?: Array<{ question?: string; answer?: string }>;
};

export interface FirstWhatsAppRun {
  sent: Array<{ id: string; name: string }>;
  failed: Array<{ id: string; name: string; why: string }>;
  /** Waiting for their daytime. */
  later: number;
}

/**
 * Sends the first WhatsApp to every prospect who should get it now (at most `max` a run). Each prospect is claimed
 * first (a change that only succeeds if nobody else changed them in between), so two runs at once never send twice.
 */
export async function sendFirstWhatsApps(nowMs = Date.now(), max = 5, onlyIds: string[] | null = null): Promise<FirstWhatsAppRun | null> {
  if (!firstWhatsAppOn()) return null;
  // A test run names its own throwaway prospects, so it can never reach a real one.
  if (onlyIds && process.env.VERCEL_ENV === "production") return null;
  const buyers = getBuyersClient();
  const since = new Date(nowMs - FIRST_WITHIN_HOURS * 3_600_000).toISOString();
  const found = await buyers.fetch<Candidate[]>(
    `*[_type == "lead" && defined(metaLeadId) && defined(phone) && defined(replyDraft) && !defined(chatThread) && !defined(metaInboxUrl)
       && coalesce(stage, "new") in ["new", "contacted"] && (!defined(whatsappFirst) || whatsappFirst.status == "retry") && _createdAt > $since
       && ($ids == null || _id in $ids)]
       | order(_createdAt asc)[0...25]{ _id, _rev, _createdAt, name, phone, metaLeadId, metaInboxUrl, chatThread, stage,
         "replyDraft": replyDraft{ status, sentVia }, whatsappFirst, formAnswers }`,
    { since, ids: onlyIds }
  );
  const run: FirstWhatsAppRun = { sent: [], failed: [], later: 0 };
  for (const lead of found) {
    if (run.sent.length + run.failed.length >= max) break;
    if (!mayWhatsAppFirst(lead, nowMs)) continue;
    if (!daytimeFor(whereTheyLive(lead.formAnswers), nowMs)) {
      run.later += 1;
      continue;
    }
    const to = whatsAppNumber(lead.phone);
    const name = lead.name ?? "";
    // Already writing to us on WhatsApp (they found the number themselves): their chat joins their record, nothing is sent.
    const existing = await buyers.getDocument<{ _id: string; messages?: unknown[] }>(threadIdFor("whatsapp", to));
    if (existing?.messages?.length) {
      await buyers.patch(lead._id).setIfMissing({ chatThread: existing._id }).commit().catch(() => undefined);
      continue;
    }
    const attempts = (lead.whatsappFirst?.attempts ?? 0) + 1;
    const at = new Date().toISOString();
    try {
      await buyers.patch(lead._id).ifRevisionId(lead._rev).set({ whatsappFirst: { status: "sending", at, attempts } }).commit();
    } catch {
      continue; // someone else changed them a moment ago: the next run looks again
    }
    const result = await sendFirstTemplate(to, name);
    if (result.ok) {
      const threadId = await startWhatsAppThread({ to, leadId: lead._id, name, text: result.words, mid: result.mid, at });
      await buyers
        .patch(lead._id)
        .set({ whatsappFirst: { status: "sent", at, attempts, mid: result.mid, to } })
        .setIfMissing({ chatThread: threadId })
        .commit();
      await note(lead._id, `WhatsApp, first message (sent by itself from The Lexington's number): ${result.words}`);
      run.sent.push({ id: lead._id, name });
    } else {
      const again = result.passing && attempts < MAX_ATTEMPTS;
      await buyers
        .patch(lead._id)
        .set({ whatsappFirst: { status: again ? "retry" : "failed", at, attempts, error: result.error.slice(0, 300) } })
        .commit()
        .catch(() => undefined);
      if (!again) {
        const why = failureWords(result.error);
        await note(lead._id, `WhatsApp, first message NOT sent: ${why}. Call them or email them instead.`);
        run.failed.push({ id: lead._id, name, why });
      }
    }
  }
  return run;
}

/**
 * WhatsApp's delivery reports: only a failed first message changes anything (its record says why, so Niko calls or
 * emails instead). Every other report (sent, delivered, read) is ignored, so a busy chat costs no extra reads.
 */
export async function recordWhatsAppStatuses(statuses: WhatsAppStatus[]): Promise<void> {
  const failed = statuses.filter((s) => s.status === "failed");
  if (!failed.length) return;
  const buyers = getBuyersClient();
  try {
    const leads = await buyers.fetch<Array<{ _id: string; mid: string }>>(
      `*[_type == "lead" && whatsappFirst.mid in $mids]{ _id, "mid": whatsappFirst.mid }`,
      { mids: failed.map((s) => s.mid) }
    );
    for (const lead of leads) {
      const report = failed.find((s) => s.mid === lead.mid);
      const why = failureWords(report?.error);
      await buyers
        .patch(lead._id)
        .set({ "whatsappFirst.status": "failed", "whatsappFirst.error": (report?.error ?? "").slice(0, 300) })
        .commit()
        .catch(() => undefined);
      await note(lead._id, `WhatsApp, first message NOT delivered: ${why}. Call them or email them instead.`);
    }
    for (const s of failed) if (!leads.some((l) => l.mid === s.mid)) console.error(`[whatsapp] a message to ${s.to} failed: ${s.error ?? "no reason given"}`);
  } catch (error) {
    console.error("[whatsapp] delivery reports not saved:", error instanceof Error ? error.message : error);
  }
}
