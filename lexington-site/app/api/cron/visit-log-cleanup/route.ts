import { purgeOldVisitLogs } from "@/lib/visits/store";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Called by Vercel once a day (vercel.json): deletes the visit record's days
// that are older than 30 days, as the privacy page promises. Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const deleted = await purgeOldVisitLogs();
    return Response.json({ deleted });
  } catch (err) {
    console.error("Visit record clean-up failed:", err);
    return new Response("Visit record clean-up failed.", { status: 500 });
  }
}
