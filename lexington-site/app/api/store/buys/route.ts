import { createBuy } from "@/lib/store/shoppingServer";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/store/buys { name, qty?, unit?, note?, photoId?, category?, itemId? | toolId?, urgent? }: something onto
 * the shopping list (anyone using the store). Answers { buy }.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json({ buy: await createBuy(me, await readJson(request)) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
