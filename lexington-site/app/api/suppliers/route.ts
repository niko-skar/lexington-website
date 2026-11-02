import { deleteBill, newSupplier, saveBill, suppliersPage } from "@/lib/suppliers/server";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/suppliers: QuickBooks' suppliers with what's owed and paid, and every bill. The office only. */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "suppliers");
    return Response.json(await suppliersPage(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/suppliers (2 Nov 2026, lib/suppliers): a bill made or changed { action: "bill", id?, vendorId, date, due?,
 * amount, description, ref?, floor?, costClass?, photoId? }, taken off { action: "deletebill", id }, or a new
 * supplier { action: "supplier", name, phone? } (made in QuickBooks). Answers with the page as it is now.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(true, "suppliers");
    const body = await readJson(request);
    let made: Record<string, unknown> = {};
    if (body.action === "bill") made = { billId: await saveBill(me, body) };
    else if (body.action === "deletebill") await deleteBill(me, body.id);
    else if (body.action === "supplier") made = { vendor: await newSupplier(body) };
    else throw new TodoError(400, "That button isn't known.");
    return Response.json({ ...(await suppliersPage()), ...made });
  } catch (error) {
    return errorResponse(error);
  }
}
