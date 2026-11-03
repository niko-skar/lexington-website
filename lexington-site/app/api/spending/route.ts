import { syncHistory } from "@/lib/quickbooks/history";
import { spendingData, supplierHistory } from "@/lib/spending/server";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/spending: everything spent, QuickBooks' and the app's own not there yet (lib/spending). The office only.
 * GET /api/spending?vendor=<QuickBooks vendor id>: one supplier's whole record.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "spending");
    const vendor = new URL(request.url).searchParams.get("vendor");
    if (vendor !== null) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(vendor)) throw new TodoError(404, "That supplier isn't known.");
      return Response.json({ entries: await supplierHistory(vendor) }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await spendingData(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/spending { action: "refresh" }: read QuickBooks again now (only reads the books). */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "spending");
    const body = await readJson(request);
    if (body.action !== "refresh") throw new TodoError(400, "That button isn't known.");
    await syncHistory(true);
    return Response.json(await spendingData());
  } catch (error) {
    return errorResponse(error);
  }
}
