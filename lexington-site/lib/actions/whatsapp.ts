"use server";

import { revalidatePath } from "next/cache";

import { sendWhatsAppByHand } from "@/lib/agents/chat";
import { crmActor, fromApp } from "@/lib/crmAccess";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

// The WhatsApp box on a prospect's page (26 Nov 2026): a message typed there goes from The Lexington's WhatsApp number
// (Cloud API, no phone app). Checks for itself that someone who may use the CRM is signed in (a Server Action can be
// called directly): the office, or a login of the app with Customers (lib/crmAccess.ts).

export interface WhatsAppFormState {
  status: "idle" | "success" | "error";
  message: string;
}

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const fail = (message: string): WhatsAppFormState => ({ status: "error", message });

export async function sendWhatsAppAction(_prev: WhatsAppFormState, formData: FormData): Promise<WhatsAppFormState> {
  const actor = await crmActor();
  if (!actor) return fail("Not authorized.");
  const id = String(formData.get("leadId") || "").trim();
  const text = String(formData.get("text") || "").trim().slice(0, 4000);
  if (!ID_RE.test(id)) return fail("Bad request.");
  if (!text) return fail("Write the message first.");

  const lead = await getBuyersClient().fetch<{ chatThread?: string } | null>(`*[_type == "lead" && _id == $id][0]{ chatThread }`, { id });
  if (!lead) return fail("Prospect not found.");
  if (!lead.chatThread?.includes(".whatsapp.")) return fail("This prospect has no chat with The Lexington's WhatsApp number.");

  const sent = await sendWhatsAppByHand(lead.chatThread, text, actor.office ? "you" : actor.by || "the team");
  if (!sent.ok) return fail(sent.error);
  if (!fromApp(formData)) {
    revalidatePath("/admin/crm");
    revalidatePath(`/admin/crm/${id}`);
  }
  return { status: "success", message: "Sent on WhatsApp. The assistant stays quiet in this chat for 12 hours." };
}
