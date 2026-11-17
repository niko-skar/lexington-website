import { settleDepositSales } from "@/lib/buyers/depositSales";
import { emailPendingReceipts } from "@/lib/receipts/email";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Called by Vercel on the schedule in vercel.json. Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; without that secret set, or with a
// wrong one, nothing runs, so the address can't be used to trigger emails.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const summary = await emailPendingReceipts();
    // A buyer whose payments reach the full deposit: their reserved homes switch to sold (lib/buyers/depositSales.ts).
    let sales: unknown = [];
    try {
      sales = await settleDepositSales();
    } catch (err) {
      console.error("Deposit sales check failed:", err);
      sales = "failed";
    }
    return Response.json({ ...summary, sales });
  } catch (err) {
    console.error("Receipt email run failed:", err);
    return new Response("Receipt email run failed.", { status: 500 });
  }
}
