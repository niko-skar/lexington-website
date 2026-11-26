import "server-only";

import { replyWindowOpen } from "@/lib/agents/whatsappCore";
import { STAGES, todayISO } from "@/lib/crm";
import { withInstagramLink } from "@/lib/crmChatLinks";
import { chatLinkOf, originLabel, phoneTail, platformOf, type ChatLink, type Platform, type ThreadRef } from "@/lib/crmOrigin";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { client } from "@/lib/sanity/client";
import { leadsListQuery, prospectPageQuery } from "@/lib/sanity/crmQueries";
import type { CrmTeamMember, Lead, UnitOption } from "@/lib/sanity/crmTypes";
import { unitOptionsQuery } from "@/lib/sanity/queries";

// What the CRM's two screens read: the prospects' lists and one prospect's page. The admin pages (/admin/crm) and the
// app's Customers part (/api/crm, 19 Nov 2026) read them the same way.

export interface CrmListData {
  leads: Lead[];
  units: UnitOption[];
  today: string;
  /** The logins with Customers, whose own lists the office gives prospects to (20 Nov 2026). */
  team: CrmTeamMember[];
}

/** Another prospect with the same phone number (however it was typed): maybe the same person. */
export interface ProspectTwin {
  id: string;
  name: string;
  platform: Platform | null;
  writtenDifferently: boolean;
}

export interface ProspectData {
  lead: Lead;
  units: UnitOption[];
  today: string;
  /** Facebook or Instagram, and the rest of where they came from. */
  origin: string;
  /** The link straight to their chat (17 Nov 2026), or their twin's when they have none of their own. */
  chat: ChatLink | null;
  /** When the chat is their twin's: the twin's first name, said on the button. */
  chatAs: string | null;
  twin: ProspectTwin | null;
  /** The website's unit status is changed by hand in Studio on purpose; this just says when it no longer matches. */
  siteMismatch: string | null;
  /** The price the buyer-login form starts with. */
  defaultPrice?: number;
  /** The logins with Customers (whose list the prospect is on, and who the office can give them to). */
  team: CrmTeamMember[];
  /**
   * Their chat with The Lexington's WhatsApp number (Cloud API, 26 Nov 2026: no phone app, so it is answered from the
   * WhatsApp box on this page), and when they last wrote in it.
   */
  whatsapp: { threadId: string; lastTheirsAt: string | null; open: boolean } | null;
}

const SOLD_STAGES = ["reserved", "paying", "paid", "handed_over"];
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

// The unit list barely changes, so it's kept for a few minutes instead of being fetched on every click.
const unitOptions = () => client.fetch<UnitOption[]>(unitOptionsQuery, {}, { next: { revalidate: 300 } });

export async function crmListData(): Promise<CrmListData> {
  const [{ leads, team }, units] = await Promise.all([
    getBuyersClient().fetch<{ leads: Lead[]; team: CrmTeamMember[] }>(leadsListQuery),
    unitOptions(),
  ]);
  return { leads, units, today: todayISO(), team };
}

type Other = Pick<Lead, "_id" | "name" | "phone" | "source" | "stage" | "metaPlatform" | "metaInboxUrl" | "adSource"> & { thread: ThreadRef | null };

/** One prospect's page, or null when there is no such prospect. */
export async function prospectData(id: string): Promise<ProspectData | null> {
  if (!ID_RE.test(id)) return null;
  const [found, units] = await Promise.all([
    getBuyersClient().fetch<{ lead: Lead | null; thread: ThreadRef | null; others: Other[]; team: CrmTeamMember[] }>(prospectPageQuery, { id }),
    unitOptions(),
  ]);
  const lead = found.lead;
  if (!lead) return null;

  // Facebook or Instagram, and the link straight to their chat (17 Nov 2026). Another prospect with the same phone
  // number, however it was typed, may be the same person: their chat is offered when this one has none.
  const tail = phoneTail(lead.phone);
  const twin = tail ? (found.others ?? []).find((o) => phoneTail(o.phone) === tail) ?? null : null;
  const ownChat = chatLinkOf(await withInstagramLink(found.thread), lead.metaInboxUrl);
  const twinChat = !ownChat && twin ? chatLinkOf(await withInstagramLink(twin.thread), twin.metaInboxUrl) : null;

  const unit = units.find((u) => u.unitNumber === lead.unitNumber);
  const siteMismatch =
    unit && SOLD_STAGES.includes(lead.stage) && unit.status === "available"
      ? `This prospect is at "${STAGES.find((s) => s.key === lead.stage)?.label}" but the website still lists unit ${unit.unitNumber} as available. Update it in Studio when you're ready.`
      : null;

  return {
    lead,
    units,
    today: todayISO(),
    origin: originLabel({ ...lead, chatChannel: found.thread?.channel }),
    chat: ownChat ?? twinChat,
    chatAs: !ownChat && twinChat && twin ? twin.name.split(/\s+/)[0] : null,
    twin: twin
      ? {
          id: twin._id,
          name: twin.name,
          platform: platformOf({ ...twin, chatChannel: twin.thread?.channel }),
          writtenDifferently: twin.phone !== lead.phone,
        }
      : null,
    siteMismatch,
    defaultPrice: lead.agreedPriceUSD ?? unit?.priceUSD,
    team: found.team ?? [],
    whatsapp:
      found.thread?.channel === "whatsapp" && found.thread._id
        ? {
            threadId: found.thread._id,
            lastTheirsAt: found.thread.lastTheirsAt ?? null,
            open: replyWindowOpen(found.thread.lastTheirsAt, Date.now()),
          }
        : null,
  };
}
