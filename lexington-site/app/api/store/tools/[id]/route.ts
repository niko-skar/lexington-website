import { setToolPhoto, toolHistory, updateTool } from "@/lib/store/tools";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/store/tools/:id: one tool and every take-out it ever had. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    return Response.json(await toolHistory(me, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PATCH /api/store/tools/:id
 *   { photoId }                  -- a new photo of the tool (anyone using the store)
 *   { name?, count?, retired? }  -- the office only
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const body = await readJson(request);
    if (Object.keys(body).length === 1 && "photoId" in body) {
      await requireTodoUser(false, "store");
      return Response.json({ tool: await setToolPhoto(id, body.photoId) });
    }
    await requireTodoUser(true, "store");
    return Response.json({ tool: await updateTool(id, body) });
  } catch (error) {
    return errorResponse(error);
  }
}
