import { timingSafeEqual } from "node:crypto";

import { GOOGLE_REPORT_MAX_BYTES, parseGoogleApplied, parseGoogleCampaigns, parseGoogleReport } from "@/lib/ads/google";
import { saveGoogleReport } from "@/lib/ads/googleStore";

export const dynamic = "force-dynamic";

/**
 * POST /api/ads/google-report: where the Google Ads script (shown on
 * /admin/dashboard/connect) sends the account's spend and clicks every hour,
 * and from version 2 each campaign's budget and what it did with the ads
 * autopilot's changes.
 *
 * Only a request carrying the secret (`Authorization: Bearer
 * <GOOGLE_ADS_REPORT_SECRET>`) is read; without the setting nothing is. The
 * answer says what was wrong, in words, so the script's log is useful.
 */

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const secret = (process.env.GOOGLE_ADS_REPORT_SECRET ?? "").trim();
  if (secret.length < 16) return json(503, { ok: false, error: "The dashboard has no report secret yet." });

  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!given || !secretMatches(given, secret)) return json(401, { ok: false, error: "Wrong or missing secret." });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > GOOGLE_REPORT_MAX_BYTES) return json(413, { ok: false, error: "The report is too big." });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > GOOGLE_REPORT_MAX_BYTES) return json(413, { ok: false, error: "The report is too big." });
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: "The report is not JSON." });
  }

  const nowMs = Date.now();
  const parsed = parseGoogleReport(body, nowMs);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.error });

  try {
    const sent = body as { version?: unknown; snapshotError?: unknown };
    await saveGoogleReport(parsed.rows, new Date(nowMs).toISOString(), {
      version: Math.max(1, Math.min(99, Math.round(Number(sent.version) || 1))),
      campaigns: parseGoogleCampaigns(body),
      applied: parseGoogleApplied(body),
      snapshotError: String(sent.snapshotError ?? "").slice(0, 300),
    });
  } catch (error) {
    console.error("[google-report] could not be stored:", error instanceof Error ? error.message : "unknown");
    return json(500, { ok: false, error: "The report could not be stored. It will be sent again next hour." });
  }
  return json(200, { ok: true, rows: parsed.rows.length });
}
