import { getBuyerSession } from "@/lib/auth/session";
import { pdfResponse, renderReceipt } from "@/lib/receipts/build";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByEmailQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";

const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

// A buyer's receipt for one of their own payments. The payment is looked up on
// the signed-in buyer's account only, so a receipt can never be fetched for
// someone else's payment.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await getBuyerSession();
  if (!session) return new Response("Please sign in to download receipts.", { status: 401 });

  const { key } = await params;
  if (!KEY_RE.test(key)) return new Response("Receipt not found.", { status: 404 });

  try {
    const buyer = await getBuyersClient().fetch<BuyerAccount | null>(buyerAccountByEmailQuery, {
      email: session.email,
    });
    if (!buyer || buyer.role === "admin") return new Response("Receipt not found.", { status: 404 });

    const file = await renderReceipt(buyer, key);
    if (!file) return new Response("Receipt not found.", { status: 404 });
    return pdfResponse(file);
  } catch (err) {
    console.error("Failed to build a receipt:", err);
    return new Response("Sorry, the receipt couldn't be created right now. Please try again.", { status: 500 });
  }
}
