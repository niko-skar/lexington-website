import { NextResponse, type NextRequest } from "next/server";

import { verifySessionToken } from "@/lib/auth/token";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/account")) {
    const token = request.cookies.get("buyer_session")?.value;
    const payload = token ? await verifySessionToken(token) : null;
    if (!payload || payload.role !== "buyer") {
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const token = request.cookies.get("admin_session")?.value;
    const payload = token ? await verifySessionToken(token) : null;
    if (!payload || payload.role !== "admin") {
      const loginUrl = new URL("/admin/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*"],
};
