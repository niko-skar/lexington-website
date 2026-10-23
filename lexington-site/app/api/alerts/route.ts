import { listAlerts, markRead, unreadCount } from "@/lib/alerts/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** GET /api/alerts: Niko's alerts, newest first (the office only). ?count=1 answers just the unread count, for the badge. */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "alerts");
    const headers = { "Cache-Control": "no-store" };
    if (new URL(request.url).searchParams.get("count") === "1") return Response.json({ unread: await unreadCount() }, { headers });
    return Response.json(await listAlerts(), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/alerts { read: "all" | [ids] }: marks alerts read. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "alerts");
    const body = await readJson(request);
    const which =
      body.read === "all"
        ? "all"
        : Array.isArray(body.read)
          ? body.read.filter((x): x is string => typeof x === "string").slice(0, 200)
          : null;
    if (!which) return Response.json({ error: "Nothing to mark." }, { status: 400 });
    const changed = await markRead(which);
    return Response.json({ changed, unread: await unreadCount() });
  } catch (error) {
    return errorResponse(error);
  }
}
