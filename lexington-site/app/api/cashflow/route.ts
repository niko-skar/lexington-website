import { cashflowPage, changeCashflow } from "@/lib/cashflow/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/cashflow: what the cash flow is worked out from (the money now, the wages, bills, orders, plans). The office only. */
export async function GET(): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "cashflow");
    return Response.json(await cashflowPage(me), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/cashflow (5 Nov 2026, lib/cashflow): the money now { action: "money", bank?, cash? }, the weekly wages
 * { action: "wages", weekly | null }, money in or out expected { action: "plan", id?, direction, what, amount, date,
 * repeat, until? } or { action: "deleteplan", id }. Answers with the page as it is now.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "cashflow");
    await changeCashflow(me, await readJson(request));
    return Response.json(await cashflowPage(me));
  } catch (error) {
    return errorResponse(error);
  }
}
