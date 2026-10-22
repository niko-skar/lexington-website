import { dropReceipt, storeReceipt } from "@/lib/expenses/server";
import { errorResponse, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/expenses/receipt: a receipt photo (shrunk on the phone) or PDF, into the private store. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    let file: FormDataEntryValue | null = null;
    try {
      file = (await request.formData()).get("file");
    } catch {
      throw new TodoError(400, "No receipt was sent.");
    }
    if (!(file instanceof File)) throw new TodoError(400, "No receipt was sent.");
    return Response.json(await storeReceipt(file));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/expenses/receipt?id=: a receipt added and then removed before saving (only if nothing uses it). */
export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    await dropReceipt(new URL(request.url).searchParams.get("id") || "");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
