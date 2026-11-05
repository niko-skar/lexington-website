import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { cashflowPage, type CashflowPage } from "@/lib/cashflow/server";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cash flow | The Lexington" };

/** The cash flow (5 Nov 2026, the office only, in Finance): the money now, and the weeks ahead. */
export default async function CashflowRoute() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/cashflow" />;
  if (me.kind !== "admin" || !me.sections.includes("cashflow")) redirect("/todo");
  let cashflow: CashflowPage | null = null;
  let failed = false;
  try {
    cashflow = await cashflowPage(me);
  } catch (error) {
    console.error("[cashflow] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="cashflow" initial={cashflow ? { cashflow } : {}} startedOffline={failed} />;
}
