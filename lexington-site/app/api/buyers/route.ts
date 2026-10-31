import { listBuyers, logBuyerPayment } from "@/lib/buyers/payments";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/buyers: every buyer, what they've paid and their receipts. The office only. */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "buyers");
    return Response.json(await listBuyers(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/buyers { buyerId, amount, currency, exchangeRate, date, method, note }: a payment, its receipt emailed at once. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "buyers");
    const { data, receipt, emailed } = await logBuyerPayment(await readJson(request));
    return Response.json({ ...data, receipt, emailed }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
