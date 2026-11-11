import { runVisitJobs } from "@/lib/siteVisits/jobs";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// 06:05, 17:05 and 19:05 (vercel.json): the morning list of today's site visits, tomorrow's reminders, and "did they
// come?" (lib/siteVisits/jobs.ts). Vercel sends "Authorization: Bearer <CRON_SECRET>"; without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    // A test copy may say what time it is (?at=2026-11-12T17:05:00Z); the live site always uses the clock.
    const at = process.env.VERCEL_ENV === "production" ? NaN : Date.parse(new URL(request.url).searchParams.get("at") ?? "");
    return Response.json(await runVisitJobs(Number.isFinite(at) ? at : Date.now()));
  } catch (err) {
    console.error("Site visit jobs failed:", err);
    return new Response("Site visit jobs failed.", { status: 500 });
  }
}
