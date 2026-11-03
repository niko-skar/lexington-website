import { changeRepair, deleteRepair } from "@/lib/store/tools";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/store/tools/repairs/:id { action: "sent", to? } | { action: "unsend" } | { action: "fixed" } (anyone using
 * the store) | { action: "scrap" } (the office): a repair moved on. Answers { repair, tool }.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    return Response.json(await changeRepair(me, id, await readJson(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/store/tools/repairs/:id: reported by mistake (the office, or whoever reported it, for a few minutes). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    return Response.json({ tool: await deleteRepair(me, id) });
  } catch (error) {
    return errorResponse(error);
  }
}
