import { createTask, errorResponse, listTasks, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/todo: the site to-do list (the phone page asks every few seconds while it's open). */
export async function GET(): Promise<Response> {
  try {
    const me = await requireTodoUser();
    const tasks = await listTasks(me);
    return Response.json({ me, tasks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/todo: a new item (photo and/or note, floor, urgent). The office only. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true);
    const task = await createTask(me, await readJson(request));
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
