import { after } from "next/server";

import { handleChatEvent, signatureValid } from "@/lib/agents/chat";
import { parseWebhook } from "@/lib/agents/chatCore";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Where Meta delivers the Page's Messenger and Instagram messages (and WhatsApp's, once that is
 * connected), set up on the dashboard's Connect page.
 * GET: Meta checks the address with the verify token (META_WEBHOOK_VERIFY_TOKEN).
 * POST: each delivery, signed with the app secret (META_APP_SECRET); anything not signed by Meta
 * is refused. It answers at once (Meta wants that within seconds) and the chat agent works after.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (token && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === token) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET?.trim();
  if (!secret) return new Response("Not set up", { status: 503 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return new Response("Too big", { status: 413 });
  if (!signatureValid(raw, request.headers.get("x-hub-signature-256"), secret)) return new Response("Bad signature", { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Not JSON", { status: 400 });
  }
  const events = parseWebhook(body, process.env.META_APP_ID?.trim() || undefined);
  if (events.length) {
    after(async () => {
      for (const event of events) await handleChatEvent(event);
    });
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
}
