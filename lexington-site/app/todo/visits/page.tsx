import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import type { VisitsData } from "@/lib/siteVisits/shared";
import { listVisits } from "@/lib/siteVisits/store";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Site visits | The Lexington" };

/** Site visits (11 Nov 2026): who is coming to see the site, booked by the visitors themselves. Customers' second tab since 19 Nov 2026 (the office, and a login with Customers). */
export default async function VisitsPage() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/visits" />;
  if (!me.sections.includes("visits")) redirect("/todo");
  let visits: VisitsData | null = null;
  try {
    visits = await listVisits();
  } catch (error) {
    console.error("[visits] load failed:", error instanceof Error ? error.message : error);
  }
  return <SiteApp me={me} section="visits" initial={visits ? { visits } : {}} startedOffline={!visits} />;
}
