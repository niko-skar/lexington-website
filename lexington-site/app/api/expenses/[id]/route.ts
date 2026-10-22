import { deleteExpense, updateExpense } from "@/lib/expenses/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** PATCH /api/expenses/:id: the whole entry as changed (the store stock follows by itself). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "expenses");
    const { id } = await params;
    return Response.json({ expense: await updateExpense(me, id, await readJson(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/expenses/:id: gone for good, with its receipt. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    const { id } = await params;
    await deleteExpense(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
