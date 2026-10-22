import { TodoApp } from "@/components/todo/TodoApp";
import { TodoSignIn } from "@/components/todo/TodoSignIn";
import { getTodoUser, listTasks } from "@/lib/todo/server";
import type { TodoTask } from "@/lib/todo/shared";

export const dynamic = "force-dynamic";

/**
 * The site to-do list (22 Oct 2026). Niko takes a photo, says what needs doing and picks the
 * floor; the foreman, on a login that opens nothing but this page, ticks jobs off (and can add a
 * photo of the fix). Both phones see each other's changes within seconds. Not signed in: the
 * page shows its own sign-in so the home-screen app never leaves /todo.
 */
export default async function TodoPage() {
  const me = await getTodoUser();
  if (!me) return <TodoSignIn />;

  let tasks: TodoTask[] = [];
  let failed = false;
  try {
    tasks = await listTasks();
  } catch (error) {
    console.error("[todo] list failed:", error instanceof Error ? error.message : error);
    failed = true;
  }
  return <TodoApp me={me} initialTasks={tasks} startedOffline={failed} />;
}
