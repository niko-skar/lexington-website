"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";

import { lockedFor, loginRules, recordFailure, recordSuccess, tooManyTries } from "@/lib/auth/loginGuard";
import { createAdminSession, destroyAdminSession, destroyBuyerSession } from "@/lib/auth/session";
import { APP_PAGES } from "@/lib/todo/shared";

// Compared as fixed-length digests, so the time taken says nothing about how much of it was right.
const digest = (s: string) => createHash("sha256").update(s).digest();

export interface AdminLoginState {
  status: "idle" | "error";
  message: string;
}

export async function adminLoginAction(
  _prevState: AdminLoginState,
  formData: FormData
): Promise<AdminLoginState> {
  const password = String(formData.get("password") || "").trim();

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error("ADMIN_PASSWORD is not set -- cannot authenticate admin.");
    return { status: "error", message: "Admin login isn't configured yet." };
  }

  // Wrong tries are counted (security check, 27 Oct 2026): too many, and this sign-in waits a while.
  const rules = await loginRules("admin");
  const wait = await lockedFor(rules);
  if (wait) return { status: "error", message: tooManyTries(wait) };

  if (!password || !timingSafeEqual(digest(password), digest(adminPassword))) {
    await recordFailure(rules);
    return { status: "error", message: "Incorrect password." };
  }

  await recordSuccess(rules);
  await createAdminSession();
  // From the site app's own sign-in: back to the page it came from.
  const next = String(formData.get("next") || "");
  redirect(APP_PAGES.includes(next) ? next : "/admin/crm");
}

export async function adminLogoutAction() {
  await destroyAdminSession();
  // An admin account signed in through the buyer login holds admin access via
  // that cookie too, so it has to go as well.
  await destroyBuyerSession();
  redirect("/login");
}
