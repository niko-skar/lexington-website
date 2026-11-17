import { NextResponse } from "next/server";

import { ACCOUNT_ID_RE, PORTAL_VIEW_COOKIE, PORTAL_VIEW_PATH, PORTAL_VIEW_SECONDS } from "@/lib/auth/portalView";
import { getAdminSession } from "@/lib/auth/session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";

// "View portal" on the admin's list of buyers: remembers which buyer's portal the admin wants to look at and opens
// the portal (lib/auth/portalView.ts has the whole story). Nobody is signed in as the buyer. A plain link opens this,
// so it must stay a link that is never fetched ahead of a click (an <a>, not next/link).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) return NextResponse.redirect(new URL("/admin/login", request.url));

  const { id } = await params;
  const account = ACCOUNT_ID_RE.test(id)
    ? await getBuyersClient()
        .fetch<{ role?: string } | null>(`*[_type == "buyerAccount" && _id == $id][0]{ role }`, { id })
        .catch(() => null)
    : null;
  // Only buyers have a portal: an admin account or a site login has none to look at.
  if (!account || account.role === "admin" || account.role === "site") return NextResponse.redirect(new URL("/admin", request.url));

  const response = NextResponse.redirect(new URL("/account", request.url));
  response.cookies.set(PORTAL_VIEW_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: PORTAL_VIEW_PATH,
    maxAge: PORTAL_VIEW_SECONDS,
  });
  return response;
}
