import { reportRepair } from "@/lib/store/tools";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/store/tools/repairs { toolId, qty, condition: "repair" | "broken", note?, photoId? }: some of a tool found
 * broken or needing repair, onto the repair list (anyone using the store). Answers { repair, tool }.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json(await reportRepair(me, await readJson(request)), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
