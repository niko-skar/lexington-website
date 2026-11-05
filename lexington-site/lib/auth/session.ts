import "server-only";
import { cookies } from "next/headers";

import { signSessionToken, verifySessionToken } from "./token";

const BUYER_COOKIE = "buyer_session";
const ADMIN_COOKIE = "admin_session";
const BUYER_SESSION_LIFETIME = "30d";
// The site app's sign-ins (the office password, Niko's own login, the site logins) last 30 days and start them again
// each day the app is used (renewAppSession). Niko, 5 Nov 2026: the office password's 12 hours signed him out "2 times
// a day"; he said yes to 30 days, renewed each time.
const APP_SESSION_DAYS = 30;
const APP_SESSION_LIFETIME = `${APP_SESSION_DAYS}d`;
/**
 * A session with less than this left is signed again when it's used: so a day after it was signed (a phone isn't sent a
 * cookie every few seconds), and at once for one signed before 5 Nov 2026 (12 hours, 7 days).
 */
const RENEW_BELOW_SECONDS = (APP_SESSION_DAYS - 1) * 24 * 60 * 60;

const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeSeconds,
});

// An admin account's login (Niko's) lasts like the site app's others since 5 Nov 2026 (it was 7 days).
export async function createBuyerSession(email: string, isAdmin = false, site = false) {
  const token = await signSessionToken(
    { role: "buyer", email, isAdmin, ...(site && !isAdmin ? { site: true } : {}) },
    isAdmin ? APP_SESSION_LIFETIME : BUYER_SESSION_LIFETIME
  );
  (await cookies()).set(BUYER_COOKIE, token, cookieOptions(60 * 60 * 24 * (isAdmin ? APP_SESSION_DAYS : 30)));
}

export async function getBuyerSession() {
  const token = (await cookies()).get(BUYER_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload || payload.role !== "buyer" || !payload.email) return null;
  return { email: payload.email, isAdmin: payload.isAdmin === true, site: payload.site === true };
}

export async function destroyBuyerSession() {
  (await cookies()).delete(BUYER_COOKIE);
}

export async function createAdminSession() {
  const token = await signSessionToken({ role: "admin" }, APP_SESSION_LIFETIME);
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(60 * 60 * 24 * APP_SESSION_DAYS));
}

/**
 * Someone using the site app: their sign-in starts its 30 days again (at most once a day), so it only ends when the app
 * goes unused for 30 days. The office password's session, and (buyer: true, when the caller has checked the account is
 * still what the login says) an admin account's or a site login's; a buyer's portal login is left as it is. Only a
 * request that may set cookies (a route handler, a server action) can renew; anywhere else this does nothing. Never
 * throws.
 */
export async function renewAppSession({ buyer: buyerToo }: { buyer: boolean }): Promise<void> {
  try {
    const jar = await cookies();
    const now = Math.floor(Date.now() / 1000);
    const stale = (expiresAt: number | null) => expiresAt === null || expiresAt - now < RENEW_BELOW_SECONDS;
    const keep = cookieOptions(60 * 60 * 24 * APP_SESSION_DAYS);

    const adminToken = jar.get(ADMIN_COOKIE)?.value;
    const admin = adminToken ? await verifySessionToken(adminToken) : null;
    if (admin?.role === "admin" && stale(admin.expiresAt)) jar.set(ADMIN_COOKIE, await signSessionToken({ role: "admin" }, APP_SESSION_LIFETIME), keep);

    const buyerToken = jar.get(BUYER_COOKIE)?.value;
    const buyer = buyerToken ? await verifySessionToken(buyerToken) : null;
    if (buyerToo && buyer?.role === "buyer" && buyer.email && (buyer.isAdmin || buyer.site) && stale(buyer.expiresAt)) {
      const claims = { role: "buyer" as const, email: buyer.email, isAdmin: buyer.isAdmin === true, ...(buyer.site && !buyer.isAdmin ? { site: true } : {}) };
      jar.set(BUYER_COOKIE, await signSessionToken(claims, APP_SESSION_LIFETIME), keep);
    }
  } catch {
    // Not a request that can set cookies (a page being drawn): the app's next request renews it.
  }
}

// Admin access comes from either the shared-password admin cookie or a
// buyer-portal login for an account whose role is "admin".
export async function getAdminSession() {
  const jar = await cookies();

  const adminToken = jar.get(ADMIN_COOKIE)?.value;
  if (adminToken) {
    const payload = await verifySessionToken(adminToken);
    if (payload && payload.role === "admin") return { role: "admin" as const };
  }

  const buyerToken = jar.get(BUYER_COOKIE)?.value;
  if (buyerToken) {
    const payload = await verifySessionToken(buyerToken);
    if (payload && payload.role === "buyer" && payload.isAdmin) return { role: "admin" as const };
  }

  return null;
}

export async function destroyAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}
