import { createTool } from "@/lib/store/tools";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** POST /api/store/tools { name, count, photoId? }: a tool for the list, with how many we have. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json({ tool: await createTool(me, await readJson(request)) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
