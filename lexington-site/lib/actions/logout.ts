"use server";

import { redirect } from "next/navigation";

import { destroyBuyerSession } from "@/lib/auth/session";

export async function logoutAction() {
  await destroyBuyerSession();
  redirect("/login");
}
