import { photoBase, readRollcall, requireRollcallUser, writeRollcall } from "@/lib/rollcall/server";
import { ROLLCALL_PARTS } from "@/lib/rollcall/shared";
import { errorResponse, readJson } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * GET /api/rollcall?me=1: who is signed in and which parts of the roll call they open.
 * GET /api/rollcall[?since=<time>]: the records this login may see (all, or those changed since).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const me = await requireRollcallUser();
    const params = new URL(request.url).searchParams;
    const headers = { "Cache-Control": "no-store" };
    if (params.get("me") === "1") {
      const sections = me.sections.filter((s) => (ROLLCALL_PARTS as readonly string[]).includes(s));
      return Response.json({ me: { id: me.id, name: me.name, kind: me.kind, sections }, cdn: photoBase() }, { headers });
    }
    const since = params.get("since");
    if (since && !ISO_RE.test(since)) return Response.json({ error: "Bad time." }, { status: 400 });
    return Response.json({ docs: await readRollcall(me, since) }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST { path: "days/2026-11-02", op: "update" | "set", data }: saves one change (see writeRollcall). */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireRollcallUser();
    const body = await readJson(request);
    const doc = await writeRollcall(me, body.path, body.op === "set" ? "set" : "update", body.data);
    return Response.json({ doc });
  } catch (error) {
    return errorResponse(error);
  }
}
