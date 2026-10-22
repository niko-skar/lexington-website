import { TodoApp } from "@/components/todo/TodoApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { getTodoUser, listTasks } from "@/lib/todo/server";
import type { TodoList, TodoTask } from "@/lib/todo/shared";

export const dynamic = "force-dynamic";

/**
 * The site to-do list (22 Oct 2026). Niko takes a photo, says what needs doing and picks the
 * floor; the foreman, on a login that opens nothing but this page, ticks jobs off (and can add a
 * photo of the fix). Both phones see each other's changes within seconds. Not signed in: the
 * page shows its own sign-in so the home-screen app never leaves /todo.
 */
export default async function TodoPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn />;
  // /todo?list=house opens the office's private house list straight away (a site login never can).
  const initialList: TodoList = me.kind === "admin" && (await searchParams).list === "house" ? "house" : "site";

  let tasks: TodoTask[] = [];
  let failed = false;
  try {
    tasks = await listTasks(me);
  } catch (error) {
    console.error("[todo] list failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <TodoApp me={me} initialTasks={tasks} initialList={initialList} startedOffline={failed} />;
}
