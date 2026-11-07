import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { analysisData } from "@/lib/analysis/server";
import type { AnalysisData } from "@/lib/analysis/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analysis | The Lexington" };

/** Analysis (7 Nov 2026, the office only): how the money's going, and every material bought, counted. */
export default async function AnalysisRoute() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/analysis" />;
  if (me.kind !== "admin" || !me.sections.includes("analysis")) redirect("/todo");
  let analysis: AnalysisData | null = null;
  let failed = false;
  try {
    analysis = await analysisData();
  } catch (error) {
    console.error("[analysis] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="analysis" initial={analysis ? { analysis } : {}} startedOffline={failed} />;
}
