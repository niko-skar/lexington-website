import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { reporterData, type ReporterData } from "@/lib/agents/progress";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Site updates | The Lexington" };
// Publishing waits for Instagram to process every photo of a swipe-through post (as on /admin/progress).
export const maxDuration = 300;

/**
 * Site updates in the site app (11 Nov 2026, the office only): site photos to the top of the website's Construction
 * Progress page and out on Facebook and Instagram (lib/agents/progress; the same reporter as /admin/progress).
 */
export default async function UpdatesAppPage() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/updates" />;
  if (me.kind !== "admin" || !me.sections.includes("updates")) redirect("/todo");
  let updates: ReporterData | null = null;
  let failed = false;
  try {
    updates = await reporterData();
  } catch (error) {
    console.error("[updates] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="updates" initial={updates ? { updates } : {}} startedOffline={failed} />;
}
