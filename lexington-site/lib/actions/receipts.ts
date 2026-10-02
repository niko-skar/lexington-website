"use server";

import { revalidatePath } from "next/cache";

import { getAdminSession } from "@/lib/auth/session";
import { markReceiptEmailed, sendReceiptEmail } from "@/lib/receipts/email";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByIdQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";

export interface EmailReceiptState {
  status: "idle" | "success" | "error";
  message: string;
}

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

// "Email to buyer" on the admin page: sends (or re-sends) one receipt right now.
export async function emailReceiptNowAction(
  _prev: EmailReceiptState,
  formData: FormData
): Promise<EmailReceiptState> {
  if (!(await getAdminSession())) return { status: "error", message: "Not authorized." };

  const buyerId = String(formData.get("buyerId") || "");
  const key = String(formData.get("paymentKey") || "");
  if (!ID_RE.test(buyerId) || !KEY_RE.test(key)) return { status: "error", message: "Missing payment." };

  try {
    const buyer = await getBuyersClient().fetch<BuyerAccount | null>(buyerAccountByIdQuery, { id: buyerId });
    if (!buyer) return { status: "error", message: "Buyer not found." };

    const result = await sendReceiptEmail(buyer, key);
    if (!result.ok) return { status: "error", message: `Couldn't send: ${result.error}` };

    await markReceiptEmailed(buyer._id, key, result.to);
    revalidatePath(`/admin/${buyerId}`);
    return { status: "success", message: `Sent ${result.number} to ${result.to}.` };
  } catch (err) {
    console.error("Failed to email a receipt:", err);
    return { status: "error", message: "Something went wrong sending that." };
  }
}
