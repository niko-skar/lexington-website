import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { ProspectsData } from "@/components/todo/ProspectsApp";
import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { crmListData, prospectData, type CrmListData, type ProspectData } from "@/lib/crmPage";
import { getTodoUser } from "@/lib/todo/server";
import { prospectHref } from "@/lib/todo/shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prospect | The Lexington" };
// "Write a suggested reply" runs from here and can wait up to a minute for Claude.
export const maxDuration = 120;

const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

/**
 * One prospect's page in the app (19 Nov 2026), opened by its address (a link, a phone alert): the lists come with it.
 * When it can't be read (no signal), the app opens and reads it itself.
 */
export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next={ID_RE.test(id) ? prospectHref(id) : "/todo/customers"} />;
  if (!me.sections.includes("prospects")) redirect("/todo");
  if (!ID_RE.test(id)) redirect("/todo/customers");
  let found: [CrmListData, ProspectData | null] | null = null;
  try {
    found = await Promise.all([crmListData(), prospectData(id)]);
  } catch (error) {
    console.error("[prospects] load failed:", error instanceof Error ? error.message : error);
  }
  if (found && !found[1]) redirect("/todo/customers");
  const prospects: ProspectsData | null = found && found[1] ? { list: found[0], page: found[1] } : null;
  return <SiteApp me={me} section="prospects" initial={prospects ? { prospects } : {}} startedOffline={!prospects} />;
}
