import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { steelData, type SteelData } from "@/lib/steel/server";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Steel | The Lexington" };

/** The steel tracker (2 Nov 2026, the office only): tons bought, bent and installed, and what the steel benders are owed. */
export default async function SteelPage() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/steel" />;
  if (me.kind !== "admin" || !me.sections.includes("steel")) redirect("/todo");
  let steel: SteelData | null = null;
  let failed = false;
  try {
    steel = await steelData(me);
  } catch (error) {
    console.error("[steel] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="steel" initial={steel ? { steel } : {}} startedOffline={failed} />;
}
