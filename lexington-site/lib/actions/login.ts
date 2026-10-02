"use server";

import { redirect } from "next/navigation";

import { verifyPassword } from "@/lib/auth/password";
import { createBuyerSession } from "@/lib/auth/session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByEmailQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";

export interface LoginState {
  status: "idle" | "error";
  message: string;
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "").trim();

  if (!email || !password) {
    return { status: "error", message: "Please enter your email and password." };
  }

  // One generic message either way -- never reveal whether the account
  // exists, only that the combination didn't work.
  const invalid: LoginState = { status: "error", message: "Invalid email or password." };

  let buyer: BuyerAccount | null;
  try {
    buyer = await getBuyersClient().fetch<BuyerAccount | null>(buyerAccountByEmailQuery, { email });
  } catch (err) {
    console.error("Failed to look up buyer account:", err);
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  if (!buyer || !buyer.passwordHash) {
    return invalid;
  }

  const valid = await verifyPassword(password, buyer.passwordHash);
  if (!valid) {
    return invalid;
  }

  const isAdmin = buyer.role === "admin";
  await createBuyerSession(buyer.email, isAdmin);
  redirect(isAdmin ? "/admin" : "/account");
}
