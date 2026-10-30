import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { listConcrete } from "@/lib/concrete/server";
import type { ConcreteData } from "@/lib/concrete/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Concrete | The Lexington" };

/** The concrete trucks on pour days (30 Oct 2026): a photo of each waybill, the road time, slump and cubes. */
export default async function ConcretePage({ searchParams }: { searchParams: Promise<{ open?: string; alert?: string }> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/concrete" />;
  if (!me.sections.includes("concrete")) redirect("/todo");
  // A tap on a phone alert about a truck: /todo/concrete?open=<truck>&alert=<its alert>.
  const params = await searchParams;
  const openTruck = typeof params.open === "string" && /^concretetruck-(live|dev)-[a-f0-9]{12}$/.test(params.open) ? params.open : undefined;
  const seenAlert = me.kind === "admin" && typeof params.alert === "string" && /^alert-(live|dev)-[a-f0-9]{12}$/.test(params.alert) ? params.alert : undefined;

  let concrete: ConcreteData = { trucks: [], days: [] };
  let failed = false;
  try {
    concrete = await listConcrete();
  } catch (error) {
    console.error("[concrete] load failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <SiteApp me={me} section="concrete" initial={{ concrete }} openTruck={openTruck} seenAlert={seenAlert} startedOffline={failed} />;
}
