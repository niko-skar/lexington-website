import { putTogether } from "@/lib/store/merge";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/store/doubles/together { from: { kind, id }, into: { kind, id }, count, name?: "from" }: the office puts a
 * double into the one it's the same as; everything recorded on it moves over (lib/store/merge.ts).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "store");
    return Response.json(await putTogether(me, await readJson(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
