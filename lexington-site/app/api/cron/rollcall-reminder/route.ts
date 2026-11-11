import { LIVE } from "@/lib/alerts/notify";
import { sendRollcallReminder } from "@/lib/rollcall/reminders";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// The roll call's reminders (vercel.json; Ghana time is GMT): Monday to Friday at 7:45, 12:58 and 16:45, Saturday at
// 7:45 and 14:00. Each call buzzes the phones of those who take the roll call; called at any other time it sends
// nothing. Vercel sends "Authorization: Bearer <CRON_SECRET>"; without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Off the live site only, a test can say what time to take it for (?at=2026-11-11T07:45:00Z).
  const at = LIVE ? null : new URL(request.url).searchParams.get("at");
  const now = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();
  try {
    return Response.json(await sendRollcallReminder(now));
  } catch (err) {
    console.error("Roll call reminder failed:", err);
    return new Response("Roll call reminder failed.", { status: 500 });
  }
}
