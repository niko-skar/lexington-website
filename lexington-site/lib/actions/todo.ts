"use server";

import { redirect } from "next/navigation";

import { destroyAdminSession, destroyBuyerSession } from "@/lib/auth/session";

/** Sign out of the site to-do list and come back to its own sign-in screen (it may be a home-screen app). */
export async function todoSignOutAction() {
  await destroyBuyerSession();
  await destroyAdminSession();
  redirect("/todo");
}
