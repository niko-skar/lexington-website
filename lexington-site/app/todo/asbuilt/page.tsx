import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { AsBuiltTab } from "@/components/asbuilt/AsBuiltApp";
import type { AsBuiltData } from "@/components/todo/AsBuiltPart";
import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { isRealRecord, readFloors } from "@/lib/asbuilt/store";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "As-built | The Lexington" };

const TABS: AsBuiltTab[] = ["plan", "list", "setout", "history"];
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * The as-built record in the site app (10 Nov 2026, the office only): every floor's grid, columns, lift cores,
 * openings and slab edges as drawn and as measured (lib/asbuilt; the same record as /admin/asbuilt).
 */
export default async function AsBuiltAppPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/asbuilt" />;
  if (me.kind !== "admin" || !me.sections.includes("asbuilt")) redirect("/todo");
  const params = await searchParams;
  let asbuilt: AsBuiltData | null = null;
  let failed = false;
  try {
    const view = one(params.view) as AsBuiltTab;
    asbuilt = { floors: await readFloors(), real: isRealRecord(), floor: one(params.floor) || undefined, view: TABS.includes(view) ? view : undefined };
  } catch (error) {
    console.error("[asbuilt] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="asbuilt" initial={asbuilt ? { asbuilt } : {}} startedOffline={failed} />;
}
