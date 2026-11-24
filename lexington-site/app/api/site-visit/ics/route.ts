import { client } from "@/lib/sanity/client";
import { siteSettingsQuery } from "@/lib/sanity/queries";
import type { SiteSettings } from "@/lib/sanity/types";
import { googleMapsUrl } from "@/lib/maps";
import { visitIcs } from "@/lib/siteVisits/ics";
import { manageUrl, visitForOwner } from "@/lib/siteVisits/store";

export const dynamic = "force-dynamic";

// GET /api/site-visit/ics?v=<visit>&t=<its token>: the visit as a calendar file ("Add to my calendar").
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("v") ?? "").slice(0, 40);
  const token = (url.searchParams.get("t") ?? "").slice(0, 40);
  const visit = await visitForOwner(id, token).catch(() => null);
  if (!visit || visit.status !== "booked") return new Response("Not found", { status: 404 });
  const settings = await client.fetch<SiteSettings>(siteSettingsQuery);
  // A video tour happens on a WhatsApp call, not at the site.
  const video = visit.kind === "video";
  const body = visitIcs({
    id: visit.id,
    slot: visit.slot,
    location: video ? "WhatsApp video call" : settings.officeAddress,
    description: video
      ? `Your video tour of The Lexington: we video call you on WhatsApp${visit.phone ? ` (${visit.phone})` : ""}. To change or cancel: ${manageUrl(visit.id)}`
      : `Your visit to The Lexington. Map: ${googleMapsUrl()}. To change or cancel: ${manageUrl(visit.id)}`,
    url: manageUrl(visit.id),
    title: video ? "Video tour: The Lexington" : undefined,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${video ? "Video-tour" : "Site-visit"}-The-Lexington.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
