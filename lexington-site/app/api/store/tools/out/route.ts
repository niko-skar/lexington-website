import { takeOutTools } from "@/lib/store/tools";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** POST /api/store/tools/out { person, photoId, note?, lines: [{ toolId, qty }] }: tools going out with someone. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json({ outs: await takeOutTools(me, await readJson(request)) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
