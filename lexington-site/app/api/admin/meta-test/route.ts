import { randomUUID } from "node:crypto";

import { headers } from "next/headers";

import { getAdminSession } from "@/lib/auth/session";
import { META_PIXEL_ID, capiKey, postToMeta } from "@/lib/meta/conversions";
import { buildCapiEvent, clientIp } from "@/lib/meta/conversionsCore";

export const dynamic = "force-dynamic";

/**
 * A TEST event to Meta, to see the website's reports arrive: open Events Manager > the dataset > Test events, copy its
 * test code, then open /api/admin/meta-test?code=TEST12345 while signed in to the admin. The event carries Meta's test
 * code, so it only shows under Test events and counts for nothing. Admin only.
 */
export async function GET(request: Request) {
  if (!(await getAdminSession())) return Response.json({ error: "Please sign in to the admin first." }, { status: 401 });
  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  if (!/^TEST[A-Z0-9]{2,20}$/i.test(code)) return Response.json({ error: "Add ?code= with the test code from Events Manager > Test events (it starts with TEST)." }, { status: 400 });
  const key = capiKey();
  const h = await headers();
  const event = buildCapiEvent(
    { name: "Lead", id: `test-${randomUUID()}`, contentName: "Test from the website" },
    {},
    { ip: clientIp(h.get("x-real-ip"), h.get("x-forwarded-for")), userAgent: h.get("user-agent") ?? undefined, url: "https://www.lexington.com.gh/contact" }
  );
  const answer = await postToMeta([event], code);
  return Response.json({ pixel: META_PIXEL_ID, key: key?.which ?? "none", answer });
}
