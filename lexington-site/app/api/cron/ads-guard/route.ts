import { runAdsManager } from "@/lib/agents/adsManager";
import { runPilotMidnightCuts } from "@/lib/agents/adsPilot";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Every night at 00:10 GMT (vercel.json), the start of the ad account's day:
// - the autopilot's budget cuts Meta wouldn't take the day before, because the campaign had already spent more than
//   the new budget that day (the US and Canada adverts spend most of theirs before the 6:00 run);
// - the ads manager's short run, so an ad quoting an offer is switched off the night the offer ends, not the next
//   morning.
// Bearer CRON_SECRET, as every cron.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const cuts = await runPilotMidnightCuts();
  const result = await runAdsManager({ mode: "guard" });
  if ("error" in result) return new Response(`The ads manager did not run: ${result.error}`, { status: 500 });
  return Response.json({
    ranAt: result.ranAt,
    mode: result.mode,
    changes: result.changes.length,
    made: result.changes.filter((c) => c.done).length,
    errors: result.errors.length,
    budgetCuts: cuts,
  });
}
