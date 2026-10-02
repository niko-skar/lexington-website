import "server-only";
import { randomBytes } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByEmailQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";
import { hashPassword } from "./password";

// Shared by the Admin "Create account" form and the CRM's "Create buyer
// login". Deliberately NOT in a "use server" file: everything exported from
// one of those becomes a callable endpoint, and callers check admin access
// themselves before getting here.

export function generatePassword() {
  return randomBytes(9).toString("base64url");
}

export type CreateBuyerResult =
  | { ok: true; id: string; password: string }
  | { ok: false; message: string };

export async function createBuyerAccountRecord(input: {
  email: string;
  name: string;
  unitNumber: string;
  contractPriceUSD: number;
  password?: string;
}): Promise<CreateBuyerResult> {
  const client = getBuyersClient();
  const email = input.email.trim().toLowerCase();

  const existing = await client.fetch<BuyerAccount | null>(buyerAccountByEmailQuery, { email });
  if (existing) {
    return { ok: false, message: "An account with this email already exists." };
  }

  const password = input.password || generatePassword();
  const passwordHash = await hashPassword(password);

  const doc = await client.create({
    _type: "buyerAccount",
    email,
    name: input.name,
    unitNumber: input.unitNumber,
    contractPriceUSD: input.contractPriceUSD,
    passwordHash,
    payments: [],
    signedAgreements: [],
  });

  return { ok: true, id: doc._id, password };
}
