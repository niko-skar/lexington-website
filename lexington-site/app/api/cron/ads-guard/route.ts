import { runAdsManager } from "@/lib/agents/adsManager";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Every night at 00:10 GMT (vercel.json): the ads manager's short run, so an ad quoting an offer is
// switched off the night the offer ends, not the next morning. Bearer CRON_SECRET, as every cron.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runAdsManager({ mode: "guard" });
  if ("error" in result) return new Response(`The ads manager did not run: ${result.error}`, { status: 500 });
  return Response.json({ ranAt: result.ranAt, mode: result.mode, changes: result.changes.length, made: result.changes.filter((c) => c.done).length, errors: result.errors.length });
}
