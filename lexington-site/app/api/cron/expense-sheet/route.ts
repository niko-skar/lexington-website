import { syncPending } from "@/lib/expenses/sheet";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Every 15 minutes (vercel.json): sends the Google Sheet anything it missed (no signal at the
// sheet's end, a failed copy, the first fill of the old entries). Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json(await syncPending(30));
  } catch (err) {
    console.error("Expense sheet run failed:", err);
    return new Response("Expense sheet run failed.", { status: 500 });
  }
}
