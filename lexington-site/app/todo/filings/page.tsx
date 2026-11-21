import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { filingsPage, type FilingsPage } from "@/lib/filings/server";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tax & filings | The Lexington" };

/** Tax & filings (21 Nov 2026, the office only, in Finance): what the company must file and when, with the figures ready. */
export default async function FilingsRoute({ searchParams }: { searchParams: Promise<{ open?: string; alert?: string }> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/filings" />;
  if (me.kind !== "admin" || !me.sections.includes("filings")) redirect("/todo");
  const params = await searchParams;
  // A tap on a phone alert: ?open=<return, e.g. vat:2026-12, or a set-up task>&alert=<its alert>.
  const openFiling = typeof params.open === "string" && /^[a-z0-9-]{2,20}(:[0-9A-Za-z-]{4,10})?$/.test(params.open) ? params.open : undefined;
  const seenAlert = typeof params.alert === "string" && /^alert-(live|dev)-[a-f0-9]{12}$/.test(params.alert) ? params.alert : undefined;
  let filings: FilingsPage | null = null;
  let failed = false;
  try {
    filings = await filingsPage();
  } catch (error) {
    console.error("[filings] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="filings" initial={filings ? { filings } : {}} openFiling={openFiling} seenAlert={seenAlert} startedOffline={failed} />;
}
