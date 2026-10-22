import { addMove, getStore } from "@/lib/store/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/store: every item with its stock, and what moved lately (the page asks every few seconds). */
export async function GET(): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json({ me, ...(await getStore(me)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/store { kind: out | back | count | in, itemId, qty, floor?, person?, note? }. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json(await addMove(me, await readJson(request)), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
