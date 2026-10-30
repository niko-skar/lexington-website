import { dismissDebit } from "@/lib/expenses/bankDebit";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** POST /api/expenses/bank-debit { id, action: "dismiss" | "restore" }: a bank debit that isn't an expense, or back on the list. The office only. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    const body = await readJson(request);
    if (body.action !== "dismiss" && body.action !== "restore") throw new TodoError(400, "That button isn't known.");
    await dismissDebit(body.id, body.action === "restore");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
