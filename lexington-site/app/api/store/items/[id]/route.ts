import { itemHistory, updateItem } from "@/lib/store/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/store/items/:id: one item and everything that ever moved for it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    return Response.json(await itemHistory(me, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** PATCH /api/store/items/:id { name?, unit?, low?, stocked? }: the office only. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireTodoUser(true, "store");
    const { id } = await params;
    return Response.json({ item: await updateItem(id, await readJson(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}
