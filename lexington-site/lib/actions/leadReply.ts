"use server";

import { revalidatePath } from "next/cache";

import { discardReply, draftReply, recordReplySent, sendReplyEmail } from "@/lib/agents/leadReply";
import { getAdminSession } from "@/lib/auth/session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import type { Lead } from "@/lib/sanity/crmTypes";

// The buttons of the "Suggested reply" box on a prospect's page. Each one checks for
// itself that the admin is signed in (a Server Action can be called directly).

export interface ReplyFormState {
  status: "idle" | "success" | "error";
  message: string;
}

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const fail = (message: string): ReplyFormState => ({ status: "error", message });

function refresh(id: string) {
  revalidatePath("/admin/crm");
  revalidatePath(`/admin/crm/${id}`);
}

const text = (formData: FormData, name: string, max: number) => String(formData.get(name) || "").trim().slice(0, max);

export async function sendReplyAction(_prev: ReplyFormState, formData: FormData): Promise<ReplyFormState> {
  if (!(await getAdminSession())) return fail("Not authorized.");
  const id = text(formData, "leadId", 80);
  const subject = text(formData, "subject", 160);
  const body = text(formData, "body", 8000);
  if (!ID_RE.test(id)) return fail("Bad request.");
  if (!subject || !body) return fail("The subject and the email can't be empty.");

  const lead = await getBuyersClient().fetch<Pick<Lead, "name" | "email" | "replyDraft"> | null>(
    `*[_type == "lead" && _id == $id][0]{ name, email, replyDraft }`,
    { id }
  );
  if (!lead) return fail("Prospect not found.");
  if (lead.replyDraft?.status === "sent") return fail("This reply has already been sent.");

  const sent = await sendReplyEmail(lead, subject, body);
  if (!sent.ok) return fail(sent.error);
  try {
    await recordReplySent(id, { subject, body, via: "email" });
  } catch (error) {
    console.error("[lead responder] sent, but the CRM was not updated:", error);
    return { status: "success", message: `Sent to ${lead.email}. (The CRM could not be updated: tick the step off by hand.)` };
  }
  refresh(id);
  return { status: "success", message: `Sent to ${lead.email}.` };
}

/** Pressed "Open in WhatsApp": the text goes out from Niko's own phone, so this only records it. */
export async function markWhatsAppSentAction(formData: FormData): Promise<void> {
  if (!(await getAdminSession())) throw new Error("Not authorized.");
  const id = text(formData, "leadId", 80);
  const body = text(formData, "whatsapp", 3000);
  if (!ID_RE.test(id)) throw new Error("Bad request.");
  await recordReplySent(id, { subject: "WhatsApp", body, via: "whatsapp" });
  refresh(id);
}

export async function discardReplyAction(formData: FormData): Promise<void> {
  if (!(await getAdminSession())) throw new Error("Not authorized.");
  const id = text(formData, "leadId", 80);
  if (!ID_RE.test(id)) throw new Error("Bad request.");
  await discardReply(id);
  refresh(id);
}

/** Writes the suggested reply (again), optionally from a message Niko pastes in (a WhatsApp chat, a call). */
export async function redraftReplyAction(_prev: ReplyFormState, formData: FormData): Promise<ReplyFormState> {
  if (!(await getAdminSession())) return fail("Not authorized.");
  const id = text(formData, "leadId", 80);
  const message = text(formData, "message", 4000);
  if (!ID_RE.test(id)) return fail("Bad request.");
  const draft = await draftReply(id, { message });
  if (!draft) return fail("The reply could not be written. Please try again in a minute.");
  refresh(id);
  return {
    status: "success",
    message: draft.writer === "claude" ? "New suggested reply ready." : "Suggested reply ready (the standard one: Claude isn't connected).",
  };
}
