import { runAdsManager } from "@/lib/agents/adsManager";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Every morning at 05:30 GMT (vercel.json), before the autopilot sets the budgets at 06:00:
// the ads manager's full run (new ads, switching off, keeping ad sets running, new markets).
// Vercel sends "Authorization: Bearer <CRON_SECRET>"; without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runAdsManager({ mode: "full" });
  if ("error" in result) return new Response(`The ads manager did not run: ${result.error}`, { status: 500 });
  return Response.json({ ranAt: result.ranAt, mode: result.mode, changes: result.changes.length, made: result.changes.filter((c) => c.done).length, errors: result.errors.length });
}
