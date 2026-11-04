import { sameThing } from "@/lib/store/merge";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/store/doubles/same { into: { kind, id }, kind, name, count, unit?, photoId? }: "Yes, it's this one". Nothing
 * new goes on the list; what was counted goes on that one (lib/store/merge.ts).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json(await sameThing(me, await readJson(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
