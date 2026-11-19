import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { ProspectsData } from "@/components/todo/ProspectsApp";
import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { crmListData } from "@/lib/crmPage";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prospects | The Lexington" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * The prospects in the app (19 Nov 2026): Customers' first tab, the CRM's lists (the same as /admin/crm). The office, and
 * a login the office gave Customers to.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/customers" />;
  if (!me.sections.includes("prospects")) redirect("/todo");
  const params = await searchParams;
  let prospects: ProspectsData | null = null;
  try {
    prospects = { list: await crmListData(), at: { view: one(params.view), stage: one(params.stage) } };
  } catch (error) {
    console.error("[prospects] load failed:", error instanceof Error ? error.message : error);
  }
  return <SiteApp me={me} section="prospects" initial={prospects ? { prospects } : {}} startedOffline={!prospects} />;
}
