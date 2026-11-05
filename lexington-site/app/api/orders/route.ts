import { moveOrder, ordersPage, saveOrder } from "@/lib/orders/server";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/orders: the purchase orders with what has billed and paid them, and what the order form offers. The office only. */
export async function GET(): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "orders");
    return Response.json(await ordersPage(me), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/orders (5 Nov 2026, lib/orders): an order made or changed { action: "save", id?, vendorId?, category, lines,
 * estimate?, neededBy, note?, floor?, costClass? }, or moved on { action: "ordered" | "unordered" | "close" | "cancel" |
 * "reopen", id }. Answers with the page as it is now (and the order's id when one was saved).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "orders");
    const body = await readJson(request);
    let made: Record<string, unknown> = {};
    if (body.action === "save") made = { orderId: await saveOrder(me, body) };
    else if (["ordered", "unordered", "close", "cancel", "reopen"].includes(String(body.action))) await moveOrder(me, body);
    else throw new TodoError(400, "That button isn't known.");
    return Response.json({ ...(await ordersPage(me)), ...made });
  } catch (error) {
    return errorResponse(error);
  }
}
