import { after } from "next/server";

import { deleteExpense, updateExpense } from "@/lib/expenses/server";
import { syncExpense, syncPending } from "@/lib/expenses/sheet";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** PATCH /api/expenses/:id: the whole entry as changed (the store stock follows by itself). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "expenses");
    const { id } = await params;
    const expense = await updateExpense(me, id, await readJson(request));
    after(() => syncExpense(expense.id));
    return Response.json({ expense });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/expenses/:id: gone from the app, with its receipt; the sheet row is marked "Deleted". */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    const { id } = await params;
    await deleteExpense(id);
    after(() => syncPending(0));
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
