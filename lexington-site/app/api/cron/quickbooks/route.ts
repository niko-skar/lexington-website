import { feedCron } from "@/lib/quickbooks/feed";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Every 15 minutes (vercel.json): sends QuickBooks any site expense it missed (while the feed is on),
// and keeps the saved QuickBooks login from lapsing. Vercel sends "Authorization: Bearer <CRON_SECRET>";
// without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json(await feedCron());
  } catch (err) {
    console.error("QuickBooks feed run failed:", err);
    return new Response("QuickBooks feed run failed.", { status: 500 });
  }
}
