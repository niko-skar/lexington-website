import { draftMissingReplies } from "@/lib/agents/leadReply";
import { metaLeadsConfigured, pollMetaLeads } from "@/lib/agents/metaLeads";
import { notifyOwner } from "@/lib/alerts/notify";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import type { ReplyDraft } from "@/lib/sanity/crmTypes";

// Writing a few suggested replies can take a minute or two.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TEMP_WORDS: Record<string, string> = { hot: "HOT", warm: "warm", cold: "probably not a buyer" };

/**
 * Every ten minutes (vercel.json): new Facebook / Instagram lead form entries go into
 * the CRM, every recent enquiry still without a suggested reply gets one, and Niko
 * gets an alert in the site app (a buzz on his phone) about each new Facebook lead.
 * Vercel sends "Authorization: Bearer <CRON_SECRET>"; without it nothing runs.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const meta = metaLeadsConfigured() ? await pollMetaLeads() : null;
    const drafted = await draftMissingReplies(4);

    if (meta?.added.length) {
      const ids = meta.added.map((a) => a.id);
      const drafts = await getBuyersClient().fetch<Array<{ _id: string; name: string; replyDraft?: ReplyDraft }>>(
        `*[_type == "lead" && _id in $ids]{ _id, name, replyDraft }`,
        { ids }
      );
      const lines = drafts.map((lead) => {
        const d = lead.replyDraft;
        const how = d?.temperature ? ` (${TEMP_WORDS[d.temperature]}${d.temperatureReason ? `: ${d.temperatureReason}` : ""})` : "";
        return `• ${lead.name}${how}${d ? ": suggested reply ready" : ""}`;
      });
      const hot = drafts.some((l) => l.replyDraft?.temperature === "hot");
      const subject =
        drafts.length === 1
          ? `${hot ? "HOT " : ""}Facebook lead: ${drafts[0].name}`
          : `${drafts.length} new Facebook leads${hot ? " (one is hot)" : ""}`;
      // An alert in the site app that buzzes Niko's phone (no email since 23 Oct 2026).
      await notifyOwner({
        kind: "lead",
        urgent: true,
        title: subject,
        lines: [
          drafts.length === 1 ? "A new lead came in through the Facebook / Instagram form:" : "New leads came in through the Facebook / Instagram form:",
          ...lines,
          "Each one is in the CRM with a suggested first reply to read and send.",
        ],
        links: drafts.map((lead) => ({ label: drafts.length === 1 ? "Open their record" : lead.name, url: `/admin/crm/${lead._id}` })),
      });
    }

    return Response.json({ meta, drafted });
  } catch (err) {
    console.error("Agents run failed:", err);
    return new Response("Agents run failed.", { status: 500 });
  }
}
