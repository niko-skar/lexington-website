import { getTool, markLost, returnTools } from "@/lib/store/tools";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/store/tools/back
 *   { returns: [{ outId, qty }], note?, photoId? }  -- what came back (anyone using the store)
 *   { lost: outId, note? }                         -- the office: the rest of it isn't coming back
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    if ("lost" in body) {
      const me = await requireTodoUser(true, "store");
      const outs = await markLost(me, body.lost, body.note);
      // How many we have went down: the page shows it at once.
      return Response.json({ outs, tool: outs[0] ? await getTool(outs[0].toolId) : null });
    }
    const me = await requireTodoUser(false, "store");
    return Response.json({ outs: await returnTools(me, body) });
  } catch (error) {
    return errorResponse(error);
  }
}
