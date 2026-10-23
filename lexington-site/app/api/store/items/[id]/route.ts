import { itemHistory, setItemPhoto, updateItem } from "@/lib/store/server";
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

/**
 * PATCH /api/store/items/:id
 *   { photoId }                                                   -- a new photo of the stock (anyone using the store)
 *   { name?, unit?, low?, reorderQty?, reorderDismissed?, stocked? } -- the office only
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await readJson(request);
    if (Object.keys(body).length === 1 && "photoId" in body) {
      await requireTodoUser(false, "store");
      return Response.json({ item: await setItemPhoto(id, body.photoId) });
    }
    await requireTodoUser(true, "store");
    return Response.json({ item: await updateItem(id, body) });
  } catch (error) {
    return errorResponse(error);
  }
}
