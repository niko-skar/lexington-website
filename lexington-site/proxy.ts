import { NextResponse, type NextRequest } from "next/server";

import { verifySessionToken } from "@/lib/auth/token";

// An admin: the office password's cookie, or a buyer-portal login for an account with the admin role.
async function hasAdminSignIn(request: NextRequest): Promise<boolean> {
  const adminToken = request.cookies.get("admin_session")?.value;
  const adminPayload = adminToken ? await verifySessionToken(adminToken) : null;
  if (adminPayload?.role === "admin") return true;

  const buyerToken = request.cookies.get("buyer_session")?.value;
  const buyerPayload = buyerToken ? await verifySessionToken(buyerToken) : null;
  return buyerPayload?.role === "buyer" && buyerPayload.isAdmin === true;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // An admin looking at a buyer's portal ("View portal", lib/auth/portalView.ts) needs no buyer sign-in; the pages
  // themselves check again which account they may show.
  const viewingPortal = pathname.startsWith("/account") && !!request.cookies.get("portal_view")?.value && (await hasAdminSignIn(request));

  if (pathname.startsWith("/account") && !viewingPortal) {
    const token = request.cookies.get("buyer_session")?.value;
    const payload = token ? await verifySessionToken(token) : null;
    if (!payload || payload.role !== "buyer") {
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
    // A site to-do login (the foreman) only has the list at /todo.
    if (payload.site) {
      return NextResponse.redirect(new URL("/todo", request.url));
    }
  }

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!(await hasAdminSignIn(request))) {
      const loginUrl = new URL("/admin/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*"],
};
