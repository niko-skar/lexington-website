import { redirect } from "next/navigation";

import { SiteApp } from "@/components/todo/SiteApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { getTodoUser, listTasks } from "@/lib/todo/server";
import type { TodoList, TodoTask } from "@/lib/todo/shared";

export const dynamic = "force-dynamic";

/**
 * The site to-do list (22 Oct 2026). Niko takes a photo, says what needs doing and picks the
 * floor; the foreman, on a login that opens nothing but the site app, ticks jobs off (and can add
 * a photo of the fix). Both phones see each other's changes within seconds. Not signed in: the
 * page shows its own sign-in so the home-screen app never leaves /todo. The store room and the
 * expenses are in the same app (one page, so moving between them is instant).
 */
export default async function TodoPage({ searchParams }: { searchParams: Promise<{ list?: string; open?: string; alert?: string }> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn />;
  // A storekeeper's login opens only the store room.
  if (!me.sections.includes("todo")) {
    if (me.sections.includes("store")) redirect("/todo/store");
    return <p style={{ padding: 24 }}>This login doesn&rsquo;t open anything yet. Ask the office.</p>;
  }
  const params = await searchParams;
  // /todo?list=house opens the office's private house list straight away (a site login never can).
  const initialList: TodoList = me.kind === "admin" && params.list === "house" ? "house" : "site";
  // A tap on a phone alert about a new job: /todo?open=<job>, and for the office &alert=<its alert>.
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
