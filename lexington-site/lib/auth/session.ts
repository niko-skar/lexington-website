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

export async function createBuyerSession(email: string) {
  const token = await signSessionToken({ role: "buyer", email }, BUYER_SESSION_LIFETIME);
  (await cookies()).set(BUYER_COOKIE, token, cookieOptions(60 * 60 * 24 * 30));
}

export async function getBuyerSession() {
  const token = (await cookies()).get(BUYER_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload || payload.role !== "buyer" || !payload.email) return null;
  return { email: payload.email };
}

export async function destroyBuyerSession() {
  (await cookies()).delete(BUYER_COOKIE);
}

export async function createAdminSession() {
  const token = await signSessionToken({ role: "admin" }, ADMIN_SESSION_LIFETIME);
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(60 * 60 * 12));
}

export async function getAdminSession() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload || payload.role !== "admin") return null;
  return { role: "admin" as const };
}

export async function destroyAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}
