import { timingSafeEqual } from "node:crypto";

import { googlePlanNow } from "@/lib/agents/adsPilot";

export const dynamic = "force-dynamic";

/**
 * GET /api/ads/google-plan: where the Google Ads script (version 2, on the Connect
 * page) collects the ads autopilot's changes for Google every hour: campaign budgets,
 * pausing and switching back on. Each change carries a time limit, so a late script
 * never makes yesterday's change. Nothing to do is an empty list.
 *
 * Only a request carrying the report secret (`Authorization: Bearer
 * <GOOGLE_ADS_REPORT_SECRET>`) is answered.
 */

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  const secret = (process.env.GOOGLE_ADS_REPORT_SECRET ?? "").trim();
  if (secret.length < 16) return json(503, { ok: false, error: "The dashboard has no report secret yet." });

  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!given || !secretMatches(given, secret)) return json(401, { ok: false, error: "Wrong or missing secret." });

  try {
    const { mode, plan } = await googlePlanNow();
    if (!plan) return json(200, { ok: true, mode, campaigns: [] });
    return json(200, {
      ok: true,
      mode,
      issuedAt: plan.issuedAt,
      validUntil: plan.validUntil,
      maxDaily: plan.maxDaily,
      campaigns: plan.campaigns.map((c) => ({
        id: c.id,
        ...(c.dailyBudget !== undefined && { dailyBudget: c.dailyBudget }),
        ...(c.status && { status: c.status }),
      })),
    });
  } catch (error) {
    console.error("[google-plan] could not be read:", error instanceof Error ? error.message : "unknown");
    return json(500, { ok: false, error: "The changes could not be read. Nothing to do this hour." });
  }
}
