import "server-only";
import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/auth/session";

// Shared bits of the /api/quickbooks/* routes: admin only, forms from our own pages only, and
// every answer is a redirect back to /admin/quickbooks with a short code the page turns into words.

export const STATE_COOKIE = "qbo_oauth_state";

export type OkCode = "connected" | "tested" | "disconnected";
export type ErrCode = "keys" | "denied" | "state" | "signin" | "test" | "disconnect" | "origin";

export function backToPage(request: Request, result: { ok: OkCode } | { err: ErrCode }): NextResponse {
  const url = new URL("/admin/quickbooks", request.url);
  if ("ok" in result) url.searchParams.set("ok", result.ok);
  else url.searchParams.set("err", result.err);
  // 303: after a form POST the browser comes back with a plain GET.
  return NextResponse.redirect(url, 303);
}

/** null when the request may go on; otherwise the response to send instead. */
export async function guard(request: Request, isForm: boolean): Promise<NextResponse | null> {
  if (!(await getAdminSession())) return NextResponse.redirect(new URL("/admin/login", request.url), 303);
  if (isForm) {
    // The buttons are forms on our own admin page; refuse a POST sent from anywhere else.
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== new URL(request.url).host) return backToPage(request, { err: "origin" });
  }
  return null;
}
