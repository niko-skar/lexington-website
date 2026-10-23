import { deleteCheck } from "@/lib/store/checks";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** DELETE /api/store/checks/:id: undo an opening or closing (the office any time, whoever took it for a few minutes). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const { id } = await params;
    await deleteCheck(me, id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
