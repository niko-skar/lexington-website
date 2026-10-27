import "server-only";
import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/auth/session";

// Shared bits of the /api/quickbooks/* routes: admin only, forms from our own pages only, and
// every answer is a redirect back to /admin/quickbooks with a short code the page turns into words.

export const STATE_COOKIE = "qbo_oauth_state";

export type OkCode = "connected" | "tested" | "disconnected" | "saved" | "on" | "off" | "sent" | "done";
export type ErrCode =
  | "keys"
  | "denied"
  | "state"
  | "signin"
  | "test"
  | "disconnect"
  | "origin"
  | "feed"
  | "feed-incomplete"
  | "feed-date"
  | "feed-account"
  | "feed-company";

export function backToPage(request: Request, result: { ok: OkCode } | { err: ErrCode }, extra?: Record<string, string>): NextResponse {
  const url = new URL("/admin/quickbooks", request.url);
  if ("ok" in result) url.searchParams.set("ok", result.ok);
  else url.searchParams.set("err", result.err);
  for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
  // The feed's buttons come back to the feed's part of the page.
  if ("ok" in result ? ["saved", "on", "off", "sent", "done"].includes(result.ok) : result.err.startsWith("feed")) url.hash = "feed";
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
