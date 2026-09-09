"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { getAdminSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByEmailQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";

export interface CreateBuyerState {
  status: "idle" | "success" | "error";
  message: string;
  /** Shown once so the admin can relay it to the buyer -- never stored, never logged. */
  generatedPassword?: string;
}

function generatePassword() {
  return randomBytes(9).toString("base64url");
}

export async function createBuyerAccountAction(
  _prevState: CreateBuyerState,
  formData: FormData
): Promise<CreateBuyerState> {
  // Defense in depth -- middleware already gates /admin/*, but a Server
  // Action can in principle be invoked directly, so it checks its own
  // session too.
  if (!(await getAdminSession())) {
    return { status: "error", message: "Not authorized." };
  }

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim();
  const unitNumber = String(formData.get("unitNumber") || "").trim();
  const contractPriceUSD = Number(formData.get("contractPriceUSD"));
  const customPassword = String(formData.get("password") || "").trim();

  if (!email || !name || !unitNumber || !contractPriceUSD || contractPriceUSD <= 0) {
    return { status: "error", message: "Please fill in every field with a valid contract price." };
  }

  try {
    const buyersClient = getBuyersClient();
    const existing = await buyersClient.fetch<BuyerAccount | null>(buyerAccountByEmailQuery, { email });
    if (existing) {
      return { status: "error", message: "An account with this email already exists." };
    }

    const password = customPassword || generatePassword();
    const passwordHash = await hashPassword(password);

    await buyersClient.create({
      _type: "buyerAccount",
      email,
      name,
      unitNumber,
      contractPriceUSD,
      passwordHash,
      payments: [],
      signedAgreements: [],
    });

    revalidatePath("/admin");

    return {
      status: "success",
      message: `Account created for ${email}.`,
      generatedPassword: password,
    };
  } catch (err) {
    console.error("Failed to create buyer account:", err);
    return { status: "error", message: "Something went wrong creating the account." };
  }
}

export interface ResetPasswordState {
  status: "idle" | "success" | "error";
  message: string;
  generatedPassword?: string;
}

export async function resetBuyerPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  if (!(await getAdminSession())) {
    return { status: "error", message: "Not authorized." };
  }

  const buyerId = String(formData.get("buyerId") || "").trim();
  const customPassword = String(formData.get("password") || "").trim();

  if (!buyerId) {
    return { status: "error", message: "Missing buyer id." };
  }

  try {
    const password = customPassword || generatePassword();
    const passwordHash = await hashPassword(password);

    await getBuyersClient().patch(buyerId).set({ passwordHash }).commit();

    return {
      status: "success",
      message: "Password reset.",
      generatedPassword: password,
    };
  } catch (err) {
    console.error("Failed to reset buyer password:", err);
    return { status: "error", message: "Something went wrong resetting the password." };
  }
}
