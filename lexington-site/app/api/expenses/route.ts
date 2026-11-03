import { after } from "next/server";

import { debitFor, listPendingDebits, pendingDebit, settleDebit } from "@/lib/expenses/bankDebit";
import { createWithExtras, listExpenses, totalWithExtras } from "@/lib/expenses/server";
import { syncExpense } from "@/lib/expenses/sheet";
import { cachedBookLists } from "@/lib/quickbooks/booksCache";
import { cachedVendors } from "@/lib/quickbooks/vendors";
import { ghanaDay } from "@/lib/store/shared";
import { listBills } from "@/lib/suppliers/server";
import { openBillsOf } from "@/lib/suppliers/shared";
import { feedExpense, refreshBookLists } from "@/lib/quickbooks/feed";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/expenses: every expense and money in, the bank's debits waiting to be completed, the bills still to pay and QuickBooks' supplier names. The office only. */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    const [expenses, pending, books, bills, vendors] = await Promise.all([listExpenses(), listPendingDebits(), cachedBookLists(), listBills(), cachedVendors()]);
    // The QuickBooks classes and locations, read again when they're a few hours old (for next time).
    after(() => refreshBookLists());
    // The suppliers' bills still to pay ("Pays a bill?") and QuickBooks' supplier names (the form's suggestions).
    return Response.json({ expenses, pending, books, bills: openBillsOf(bills, expenses, ghanaDay()), vendors: vendors.vendors.map((v) => v.name) }, { headers: { "Cache-Control": "no-store" } });
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
    // The bank's text is for all that was paid: the entry and its other costs together.
    const debit = fromBank ?? (body.kind === "inflow" ? null : await debitFor(body.date, totalWithExtras(body)));
    const { expense, extras } = await createWithExtras(me, body, debit ? { bank: debit.note } : {});
    if (debit) {
      await settleDebit(debit, expense.id, fromBank ? "completed" : "matched").catch((error) =>
        console.error("[expenses] bank debit not marked done:", error instanceof Error ? error.message : error)
      );
    }
    // Off to the Google Sheet and QuickBooks once the phone has its answer (the crons catch up any miss).
    for (const x of [expense, ...extras]) {
      after(() => syncExpense(x.id));
      after(() => feedExpense(x.id));
    }
    return Response.json({ expense, extras }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
