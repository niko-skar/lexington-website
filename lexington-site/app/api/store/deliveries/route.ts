import { arrive, walkIn } from "@/lib/store/deliveriesServer";
import { getStore } from "@/lib/store/server";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/store/deliveries (5 Nov 2026, lib/store/deliveries.ts), anyone using the store:
 *   { action: "arrived", kind: "expense", id, itemId, qty }   a paid purchase's goods came (all, or what came)
 *   { action: "arrived", kind: "order", id, line, qty }       a placed order's line came
 *   { action: "walkin", itemId? | name, unit?, qty }          something came that nobody said was coming
 * with { note?, photoId? }. Answers with the store as it is now.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const body = await readJson(request);
    if (body.action === "arrived") await arrive(me, body);
    else if (body.action === "walkin") await walkIn(me, body);
    else throw new TodoError(400, "That button isn't known.");
    return Response.json(await getStore(me), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
