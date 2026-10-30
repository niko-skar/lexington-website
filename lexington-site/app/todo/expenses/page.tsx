import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { listPendingDebits } from "@/lib/expenses/bankDebit";
import { listExpenses } from "@/lib/expenses/server";
import type { BankDebit, Expense } from "@/lib/expenses/shared";
import { getStore } from "@/lib/store/server";
import type { StoreItem } from "@/lib/store/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Expenses | The Lexington" };

/** The expense log (the office only), moved here from the Claude page in Oct 2026. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ open?: string; alert?: string; debit?: string }> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/expenses" />;
  if (me.kind !== "admin" || !me.sections.includes("expenses")) redirect("/todo");
  // A tap on a bank text's phone alert: /todo/expenses?open=<entry>&alert=<its alert>.
  const params = await searchParams;
  const openEntry = typeof params.open === "string" && /^expense-(live|dev)-[a-z0-9]{12,24}$/.test(params.open) ? params.open : undefined;
  const seenAlert = typeof params.alert === "string" && /^alert-(live|dev)-[a-f0-9]{12}$/.test(params.alert) ? params.alert : undefined;
  // A tap on a bank debit's phone alert: /todo/expenses?debit=<its text>&alert=<the alert>.
  const openDebit = typeof params.debit === "string" && /^banktext-(live|dev)-[a-f0-9]{12}$/.test(params.debit) ? params.debit : undefined;

  let expenses: Expense[] = [];
  let items: StoreItem[] = [];
  let pending: BankDebit[] = [];
  let failed = false;
  try {
    [expenses, { items }, pending] = await Promise.all([listExpenses(), getStore(me), listPendingDebits()]);
  } catch (error) {
    console.error("[expenses] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="expenses" initial={{ expenses: { expenses, items, pending } }} openEntry={openEntry} openDebit={openDebit} seenAlert={seenAlert} startedOffline={failed} />;
}
