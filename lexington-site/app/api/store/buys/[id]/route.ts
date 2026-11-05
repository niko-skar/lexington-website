import { changeBuy, deleteBuy } from "@/lib/store/shoppingServer";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/store/buys/:id { action: "got" | "back" } (anyone using the store) or { name?, qty?, unit?, note?,
 * category?, urgent?, photoId? } (the office; whoever added it, while it's to buy). Answers { buy, item? }.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    return Response.json(await changeBuy(me, id, await readJson(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/store/buys/:id: off the shopping list (the office; whoever added it, while it's to buy). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    await deleteBuy(me, id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
