"use server";

import { redirect } from "next/navigation";

import { lockedFor, loginRules, recordFailure, recordSuccess, tooManyTries } from "@/lib/auth/loginGuard";
import { verifyPassword } from "@/lib/auth/password";
import { createBuyerSession } from "@/lib/auth/session";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByEmailQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";
import { APP_PAGES } from "@/lib/todo/shared";

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

  // Wrong tries are counted per connection and per account (security check, 27 Oct 2026).
  const rules = await loginRules("account", email);
  const wait = await lockedFor(rules);
  if (wait) return { status: "error", message: tooManyTries(wait) };

  let buyer: BuyerAccount | null;
  try {
    buyer = await getBuyersClient().fetch<BuyerAccount | null>(buyerAccountByEmailQuery, { email });
  } catch (err) {
    console.error("Failed to look up buyer account:", err);
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  if (!buyer || !buyer.passwordHash) {
    await recordFailure(rules);
    return invalid;
  }

  const valid = await verifyPassword(password, buyer.passwordHash);
  if (!valid) {
    await recordFailure(rules);
    return invalid;
  }

  await recordSuccess(rules);
  const isAdmin = buyer.role === "admin";
  const isSite = buyer.role === "site";
  // The site app (to-do, store, expenses) signs in through this same action (hidden next=/todo...);
  // a buyer still goes to their own portal whichever form they used.
  const next = String(formData.get("next") || "");
  const appPage = APP_PAGES.includes(next) ? next : null;
  await createBuyerSession(buyer.email, isAdmin, isSite);
  redirect(isSite ? (appPage ?? "/todo") : isAdmin && appPage ? appPage : isAdmin ? "/admin/crm" : "/account");
}
