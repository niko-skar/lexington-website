import { after } from "next/server";

import { createExpense, listExpenses } from "@/lib/expenses/server";
import { syncExpense } from "@/lib/expenses/sheet";
import { feedExpense } from "@/lib/quickbooks/feed";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/expenses: every expense and money in. The office only. */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    return Response.json({ expenses: await listExpenses() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/expenses: a new entry. A Material bought "into the store room" adds to its stock. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "expenses");
    const expense = await createExpense(me, await readJson(request));
    // Off to the Google Sheet and QuickBooks once the phone has its answer (the crons catch up any miss).
    after(() => syncExpense(expense.id));
    after(() => feedExpense(expense.id));
    return Response.json({ expense }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
