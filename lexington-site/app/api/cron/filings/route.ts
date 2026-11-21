import { filingReminders } from "@/lib/filings/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Every morning (vercel.json): a tax return or company filing that's ready, 3 days away, due today or late buzzes the
// office's phone; on Mondays, the company's set-up tasks still open. Vercel sends "Authorization: Bearer <CRON_SECRET>";
// without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json(await filingReminders());
  } catch (err) {
    console.error("Filing reminders failed:", err);
    return new Response("Filing reminders failed.", { status: 500 });
  }
}
