import "server-only";
import { cookies } from "next/headers";

import { signSessionToken, verifySessionToken } from "./token";

const BUYER_COOKIE = "buyer_session";
const ADMIN_COOKIE = "admin_session";
const BUYER_SESSION_LIFETIME = "30d";
const ADMIN_SESSION_LIFETIME = "12h";

const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeSeconds,
});

// An admin account's login also carries admin access, so it expires sooner
// than an ordinary buyer's 30 days.
export async function createBuyerSession(email: string, isAdmin = false) {
  const days = isAdmin ? 7 : 30;
  const token = await signSessionToken(
    { role: "buyer", email, isAdmin },
    isAdmin ? "7d" : BUYER_SESSION_LIFETIME
  );
  (await cookies()).set(BUYER_COOKIE, token, cookieOptions(60 * 60 * 24 * days));
}

export async function getBuyerSession() {
  const token = (await cookies()).get(BUYER_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload || payload.role !== "buyer" || !payload.email) return null;
  return { email: payload.email, isAdmin: payload.isAdmin === true };
}

export async function destroyBuyerSession() {
  (await cookies()).delete(BUYER_COOKIE);
}

export async function createAdminSession() {
  const token = await signSessionToken({ role: "admin" }, ADMIN_SESSION_LIFETIME);
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(60 * 60 * 12));
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
