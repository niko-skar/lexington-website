import { sheetStatus, syncPending } from "@/lib/expenses/sheet";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/expenses/sheet: is the Google Sheet set up, and how far behind is it? The office only. */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    return Response.json(await sheetStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/expenses/sheet: catch the sheet up now (the menu's "Send to the sheet now"). */
export async function POST(): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    const result = await syncPending(40);
    return Response.json({ ...result, status: await sheetStatus() });
  } catch (error) {
    return errorResponse(error);
  }
}
