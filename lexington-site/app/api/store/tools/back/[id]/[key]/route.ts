import { deleteToolReturn, getTool } from "@/lib/store/tools";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** DELETE /api/store/tools/back/:outId/:key: undo a return (or, the office, a "lost"): it's out again. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; key: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id, key } = await params;
    const out = await deleteToolReturn(me, id, key);
    // Undoing a "lost" puts the tool back in the count: the page shows it at once.
    return Response.json({ out, tool: out ? await getTool(out.toolId) : null });
  } catch (error) {
    return errorResponse(error);
  }
}
