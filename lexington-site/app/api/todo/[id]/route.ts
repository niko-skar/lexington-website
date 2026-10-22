import { changeTask, deleteTask, errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/todo/:id with { action }:
 *   done   -- ticked off (anyone on the list; optional note / photo of the fix)
 *   reopen -- not done after all
 *   proof  -- add or change the photo of the fix / the note on a done item
 *   edit   -- change the note, floor or urgent flag (the office only)
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser();
    const { id } = await params;
    const task = await changeTask(me, id, await readJson(request));
    return Response.json({ task });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/todo/:id: off the list for good, with its photos. The office only. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireTodoUser(true);
    const { id } = await params;
    await deleteTask(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
