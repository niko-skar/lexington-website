import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { spendingData } from "@/lib/spending/server";
import type { SpendingData } from "@/lib/spending/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Spending | The Lexington" };

/** Spending (3 Nov 2026, the office only): QuickBooks' transactions with the app's own, by cost type, floor, supplier and month. */
export default async function SpendingRoute() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/spending" />;
  if (me.kind !== "admin" || !me.sections.includes("spending")) redirect("/todo");
  let spending: SpendingData | null = null;
  let failed = false;
  try {
    spending = await spendingData();
  } catch (error) {
    console.error("[spending] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="spending" initial={spending ? { spending } : {}} startedOffline={failed} />;
}
