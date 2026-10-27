import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { QBO_SCOPE, qboEndpoints, qboKeys, qboRedirectUri } from "@/lib/quickbooks/config";
import { backToPage, guard, STATE_COOKIE } from "@/lib/quickbooks/routes";
import { writeLog } from "@/lib/quickbooks/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/quickbooks/connect: the "Connect QuickBooks" button. Sends the browser to Intuit's
 * sign-in with a one-time state value (also kept in a short-lived cookie) so the answer coming back
 * can be checked against cross-site request forgery. Admin only.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = await guard(request, false);
  if (refused) return refused;

  const keys = qboKeys();
  if (!keys) return backToPage(request, { err: "keys" });

  const state = randomBytes(24).toString("hex");
  const { authorization } = await qboEndpoints(keys.environment);
  const url = new URL(authorization);
  url.searchParams.set("client_id", keys.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QBO_SCOPE);
  url.searchParams.set("redirect_uri", qboRedirectUri(request.url));
  url.searchParams.set("state", state);

  await writeLog({ action: "connect", ok: true, httpStatus: null, intuitTid: null, message: `Sent to QuickBooks sign-in (${keys.environment}).` });

  const response = NextResponse.redirect(url, 302);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/quickbooks",
    maxAge: 600,
  });
  return response;
}
