import { getAdminSession } from "@/lib/auth/session";
import { pdfResponse, renderReceipt } from "@/lib/receipts/build";
import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { buyerAccountByIdQuery } from "@/lib/sanity/buyersQueries";
import type { BuyerAccount } from "@/lib/sanity/buyersTypes";

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

// The same receipt a buyer gets, for any buyer -- so it can be sent to them.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  if (!(await getAdminSession())) return new Response("Not authorized.", { status: 401 });

  const { id, key } = await params;
  if (!ID_RE.test(id) || !KEY_RE.test(key)) return new Response("Receipt not found.", { status: 404 });

  try {
    const buyer = await getBuyersClient().fetch<BuyerAccount | null>(buyerAccountByIdQuery, { id });
    if (!buyer) return new Response("Receipt not found.", { status: 404 });

    const file = await renderReceipt(buyer, key);
    if (!file) return new Response("Receipt not found.", { status: 404 });
    return pdfResponse(file);
  } catch (err) {
    console.error("Failed to build a receipt:", err);
    return new Response("Sorry, the receipt couldn't be created right now. Please try again.", { status: 500 });
  }
}
