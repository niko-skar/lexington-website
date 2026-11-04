import { after } from "next/server";

import { lookAtWaiting } from "@/lib/store/doublesCheck";
import { addMove, getStore } from "@/lib/store/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/store: every item with its stock, and what moved lately (the page asks every few seconds). */
export async function GET(): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const store = await getStore(me);
    // The office's "To check": what's there that the double check never looked at gets its look now, a few at a time.
    if (me.kind === "admin" && [...store.items, ...store.tools].some((x) => x.review && !x.review.looked)) after(() => lookAtWaiting());
    return Response.json({ me, ...store }, { headers: { "Cache-Control": "no-store" } });
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
