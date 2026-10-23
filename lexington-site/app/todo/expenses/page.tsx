import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { listExpenses } from "@/lib/expenses/server";
import type { Expense } from "@/lib/expenses/shared";
import { getStore } from "@/lib/store/server";
import type { StoreItem } from "@/lib/store/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Expenses | The Lexington" };

/** The expense log (the office only), moved here from the Claude page in Oct 2026. */
export default async function ExpensesPage() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/expenses" />;
  if (me.kind !== "admin" || !me.sections.includes("expenses")) redirect("/todo");

  let expenses: Expense[] = [];
  let items: StoreItem[] = [];
  let failed = false;
  try {
    [expenses, { items }] = await Promise.all([listExpenses(), getStore(me)]);
  } catch (error) {
    console.error("[expenses] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="expenses" initial={{ expenses: { expenses, items } }} startedOffline={failed} />;
}
