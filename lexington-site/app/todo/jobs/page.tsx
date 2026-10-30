import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { getTodoUser, listTasks } from "@/lib/todo/server";
import type { TodoList, TodoTask } from "@/lib/todo/shared";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Site to-do | The Lexington" };

/**
 * The site to-do list (22 Oct 2026). Niko takes a photo, says what needs doing and picks the floor; the
 * foreman, on a login that opens nothing but the site app, ticks jobs off (and adds his own). Both phones
 * see each other's changes within seconds. Since 30 Oct 2026 the app opens on its home page (/todo) and
 * the list lives here; old links (/todo?open=…) are sent on to it.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<{ list?: string; open?: string; alert?: string }> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn next="/todo/jobs" />;
  if (!me.sections.includes("todo")) redirect("/todo");
  const params = await searchParams;
  // /todo/jobs?list=house opens the office's private house list straight away (a site login never can).
  const initialList: TodoList = me.kind === "admin" && params.list === "house" ? "house" : "site";
  // A tap on a phone alert about a job: ?open=<job>, and for the office &alert=<its alert>.
  const openJob = typeof params.open === "string" && /^sitetask-(live|dev)-[a-f0-9]{12}$/.test(params.open) ? params.open : undefined;
  const seenAlert = me.kind === "admin" && typeof params.alert === "string" && /^alert-(live|dev)-[a-f0-9]{12}$/.test(params.alert) ? params.alert : undefined;

  let tasks: TodoTask[] = [];
  let failed = false;
  try {
    tasks = await listTasks(me);
  } catch (error) {
    console.error("[todo] list failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return (
    <SiteApp me={me} section="todo" initial={{ todo: tasks }} initialList={initialList} openJob={openJob} seenAlert={seenAlert} startedOffline={failed} />
  );
}
