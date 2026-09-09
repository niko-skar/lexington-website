"use server";

import { redirect } from "next/navigation";

import { createAdminSession, destroyAdminSession } from "@/lib/auth/session";

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

  if (!password || password !== adminPassword) {
    return { status: "error", message: "Incorrect password." };
  }

  await createAdminSession();
  redirect("/admin");
}

export async function adminLogoutAction() {
  await destroyAdminSession();
  redirect("/admin/login");
}
