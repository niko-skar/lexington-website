import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { suppliersPage } from "@/lib/suppliers/server";
import type { SuppliersPage } from "@/lib/suppliers/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Suppliers | The Lexington" };

/** Suppliers and their bills (2 Nov 2026, the office only): QuickBooks' suppliers, what each is owed, every payment to them. */
export default async function SuppliersRoute() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/suppliers" />;
  if (me.kind !== "admin" || !me.sections.includes("suppliers")) redirect("/todo");
  let suppliers: SuppliersPage | null = null;
  let failed = false;
  try {
    suppliers = await suppliersPage();
  } catch (error) {
    console.error("[suppliers] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="suppliers" initial={suppliers ? { suppliers } : {}} startedOffline={failed} />;
}
