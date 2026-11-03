import { deleteTool, setToolCondition, setToolPhoto, toolHistory, updateTool } from "@/lib/store/tools";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/store/tools/:id: one tool, every take-out it ever had, and every time it needed fixing. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    const found = await toolHistory(me, id);
    if (me.kind !== "admin") delete found.tool.review;
    return Response.json(found, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PATCH /api/store/tools/:id
 *   { photoId }                  -- a new photo of the tool (anyone using the store)
 *   { condition }                -- the state it's in (anyone using the store)
 *   { name?, count?, retired?, trade?, condition? }  -- the office only
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await readJson(request);
    if (Object.keys(body).length === 1 && "photoId" in body) {
      await requireTodoUser(false, "store");
      return Response.json({ tool: await setToolPhoto(id, body.photoId) });
    }
    if (Object.keys(body).length === 1 && "condition" in body) {
      const me = await requireTodoUser(false, "store");
      return Response.json({ tool: await setToolCondition(me, id, body.condition) });
    }
    const me = await requireTodoUser(true, "store");
    return Response.json({ tool: await updateTool(me, id, body) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/store/tools/:id: the office deletes a tool outright, with every take-out it had. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireTodoUser(true, "store");
    const { id } = await params;
    await deleteTool(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
