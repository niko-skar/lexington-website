import { deleteToolOut } from "@/lib/store/tools";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** DELETE /api/store/tools/out/:id: undo a take-out (the office any time, whoever recorded it for a few minutes). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    await deleteToolOut(me, id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
