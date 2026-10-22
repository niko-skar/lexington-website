import { runWatchdog } from "@/lib/agents/watchdog";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Every morning at 07:00 GMT (vercel.json): the ads watchdog's daily check.
// Vercel sends "Authorization: Bearer <CRON_SECRET>"; without it nothing runs.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runWatchdog({ email: true });
  if ("error" in result) return new Response(`The ads check failed: ${result.error}`, { status: 500 });
  return Response.json({ ranAt: result.ranAt, emailed: result.emailed, findings: result.findings.length });
}
