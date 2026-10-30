import { after } from "next/server";

import { debitFor, listPendingDebits, pendingDebit, settleDebit } from "@/lib/expenses/bankDebit";
import { createExpense, listExpenses } from "@/lib/expenses/server";
import { syncExpense } from "@/lib/expenses/sheet";
import { feedExpense } from "@/lib/quickbooks/feed";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/expenses: every expense and money in, and the bank's debits waiting to be completed. The office only. */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    const [expenses, pending] = await Promise.all([listExpenses(), listPendingDebits()]);
    return Response.json({ expenses, pending }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/expenses: a new entry. A Material bought "into the store room" adds to its stock. Made from a bank
 * debit waiting in the app ({ bankDebitId }), or typed for the same day and amount as one: that debit is done.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "expenses");
    const body = await readJson(request);
    const fromBank = body.bankDebitId ? await pendingDebit(body.bankDebitId) : null;
    const debit = fromBank ?? (body.kind === "inflow" ? null : await debitFor(body.date, body.amount));
    const expense = await createExpense(me, body, debit ? { bank: debit.note } : {});
    if (debit) {
      await settleDebit(debit, expense.id, fromBank ? "completed" : "matched").catch((error) =>
        console.error("[expenses] bank debit not marked done:", error instanceof Error ? error.message : error)
      );
    }
    // Off to the Google Sheet and QuickBooks once the phone has its answer (the crons catch up any miss).
    after(() => syncExpense(expense.id));
    after(() => feedExpense(expense.id));
    return Response.json({ expense }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
