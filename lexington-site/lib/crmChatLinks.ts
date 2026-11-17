import "server-only";

import { pageAccess } from "@/lib/agents/metaLeads";
import { instagramChatUrlFrom, type ThreadRef } from "@/lib/crmOrigin";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

// An Instagram chat's own address (17 Nov 2026). Meta gives a Messenger chat's link from the person's id alone, but an
// Instagram chat's only from the conversation, which has to be looked up once: the answer is kept on the chat
// (`inboxUrl`), so each chat is looked up once on the live site. Never throws: null means "use the inbox".
export async function withInstagramLink<T extends ThreadRef>(thread: T | null): Promise<T | null> {
  if (!thread || thread.channel !== "instagram" || thread.inboxUrl || !thread.senderId) return thread;
  try {
    const access = await pageAccess();
    if (!access) return thread;
    const url = `${access.base}/${access.pageId}/conversations?${new URLSearchParams({ platform: "instagram", user_id: thread.senderId, fields: "id" })}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${access.token}` }, signal: AbortSignal.timeout(6_000), cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null;
    const id = response.ok ? body?.data?.[0]?.id : undefined;
    const inboxUrl = id ? instagramChatUrlFrom(id) : null;
    if (!inboxUrl) return thread;
    // Kept on the chat by the live site only: a test copy never writes to the real chats.
    if (thread._id && process.env.VERCEL_ENV === "production") {
      await getBuyersClient().patch(thread._id).set({ inboxUrl }).commit().catch(() => undefined);
    }
    return { ...thread, inboxUrl };
  } catch {
    return thread;
  }
}
