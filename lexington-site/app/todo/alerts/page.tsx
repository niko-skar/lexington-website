import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { listAlerts } from "@/lib/alerts/server";
import type { AlertsData } from "@/lib/alerts/shared";
import { getTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alerts | The Lexington" };

/** Niko's alerts (the office only): what the website used to email him, since 23 Oct 2026. */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/alerts" />;
  if (me.kind !== "admin" || !me.sections.includes("alerts")) redirect("/todo");

  let alerts: AlertsData | null = null;
  try {
    alerts = await listAlerts();
  } catch (error) {
    console.error("[alerts] load failed:", error instanceof Error ? error.message : error);
  }
  const open = (await searchParams).open;
  return (
    <SiteApp
      me={me}
      section="alerts"
      initial={alerts ? { alerts } : {}}
      openAlert={typeof open === "string" ? open : undefined}
      startedOffline={!alerts}
    />
  );
}
