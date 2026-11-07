import { catchUpData, cleanCatchUpKeys, sendCatchUp } from "@/lib/quickbooks/catchup";
import { syncHistory } from "@/lib/quickbooks/history";
import { cleanDateFixes, fixDates } from "@/lib/spending/fixDates";
import { spendingData, supplierHistory } from "@/lib/spending/server";
import { ghanaDay } from "@/lib/store/shared";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/spending: everything spent, QuickBooks' and the app's own not there yet (lib/spending). The office only.
 * GET /api/spending?vendor=<QuickBooks vendor id>: one supplier's whole record.
 * GET /api/spending?catchup=1: the lines from his sheet waiting to go into QuickBooks (lib/quickbooks/catchup.ts).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "spending");
    const params = new URL(request.url).searchParams;
    const vendor = params.get("vendor");
    if (vendor !== null) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(vendor)) throw new TodoError(404, "That supplier isn't known.");
      return Response.json({ entries: await supplierHistory(vendor) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (params.get("catchup") !== null) return Response.json({ catchUp: await catchUpData() }, { headers: { "Cache-Control": "no-store" } });
    return Response.json(await spendingData(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/spending { action: "refresh" }: read QuickBooks again now (only reads the books).
 * POST /api/spending { action: "fixDates", fixes: [{ key, from, to }] }: those entries' dates put right in QuickBooks
 * (lib/spending/fixDates.ts); answers { results, data }.
 * POST /api/spending { action: "catchUp", batch, keys: [...] }: those lines from his sheet into QuickBooks, a few at a
 * time (lib/quickbooks/catchup.ts); answers { results, catchUp }.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "spending");
    const body = await readJson(request);
    if (body.action === "fixDates") {
      const results = await fixDates(cleanDateFixes(body.fixes, ghanaDay()));
      return Response.json({ results, data: await spendingData() });
    }
    if (body.action === "catchUp") {
      return Response.json(await sendCatchUp(typeof body.batch === "string" ? body.batch : "", cleanCatchUpKeys(body.keys)));
    }
    if (body.action !== "refresh") throw new TodoError(400, "That button isn't known.");
    await syncHistory(true);
    return Response.json(await spendingData());
  } catch (error) {
    return errorResponse(error);
  }
}
