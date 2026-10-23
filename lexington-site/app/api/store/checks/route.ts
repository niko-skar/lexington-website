import { addCheck, olderChecks } from "@/lib/store/checks";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/store/checks?before=<time>: opening and closing photos older than the page has. */
export async function GET(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    const before = new URL(request.url).searchParams.get("before");
    return Response.json({ checks: await olderChecks(me, before) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/store/checks { kind: open | close, photoIds, note? }: the store room opened or closed, with photos. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json({ check: await addCheck(me, await readJson(request)) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
