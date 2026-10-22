import { draftMissingReplies } from "@/lib/agents/leadReply";
import { metaLeadsConfigured, pollMetaLeads } from "@/lib/agents/metaLeads";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import type { ReplyDraft } from "@/lib/sanity/crmTypes";
import { SITE_URL } from "@/lib/seo";
import { sendNotice } from "@/lib/social/notify";

// Writing a few suggested replies can take a minute or two.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TEMP_WORDS: Record<string, string> = { hot: "HOT", warm: "warm", cold: "probably not a buyer" };

/**
 * Every ten minutes (vercel.json): new Facebook / Instagram lead form entries go into
 * the CRM, every recent enquiry still without a suggested reply gets one, and Niko
 * is emailed about each new Facebook lead with a link to its reply.
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
      const lines = drafts.flatMap((lead) => {
        const d = lead.replyDraft;
        const how = d?.temperature ? ` (${TEMP_WORDS[d.temperature]}${d.temperatureReason ? `: ${d.temperatureReason}` : ""})` : "";
        return [
          `• ${lead.name}${how}`,
          `${d ? "Suggested reply ready" : "Open"}: ${SITE_URL}/admin/crm/${lead._id}`,
        ];
      });
      const hot = drafts.some((l) => l.replyDraft?.temperature === "hot");
      const subject =
        drafts.length === 1
          ? `${hot ? "HOT " : ""}Facebook lead: ${drafts[0].name}`
          : `${drafts.length} new Facebook leads${hot ? " (one is hot)" : ""}`;
      await sendNotice(subject, [
        drafts.length === 1 ? "A new lead came in through the Facebook / Instagram form:" : "New leads came in through the Facebook / Instagram form:",
        ...lines,
        "Each one is in the CRM with a suggested first reply to read and send.",
      ]);
    }

    return Response.json({ meta, drafted });
  } catch (err) {
    console.error("Agents run failed:", err);
    return new Response("Agents run failed.", { status: 500 });
  }
}
