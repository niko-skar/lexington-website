import { runAdsPilot } from "@/lib/agents/adsPilot";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Every morning at 06:00 GMT (vercel.json), before the 07:00 ads check: the ads autopilot.
// Vercel sends "Authorization: Bearer <CRON_SECRET>"; without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runAdsPilot();
  if ("error" in result) return new Response(`The ads autopilot did not run: ${result.error}`, { status: 500 });
  return Response.json({
    ranAt: result.ranAt,
    mode: result.mode,
    changes: result.changes.length,
    made: result.changes.filter((c) => c.done !== "not").length,
    errors: result.errors.length,
  });
}
