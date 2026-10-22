import { deleteMove } from "@/lib/store/server";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** DELETE /api/store/moves/:id: undo a wrong entry (the office any time, a site login its own for a few minutes). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    return Response.json({ item: await deleteMove(me, id) });
  } catch (error) {
    return errorResponse(error);
  }
}
