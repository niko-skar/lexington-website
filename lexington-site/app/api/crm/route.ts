import { crmListData, prospectData } from "@/lib/crmPage";
import { TodoError, errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm: the prospects' lists (the app's Customers part, 19 Nov 2026); GET /api/crm?id=<prospect>: one prospect's
 * page. The office, or a login the office gave Customers to. The changes go through the CRM's own Server Actions
 * (lib/actions/crm.ts, lib/actions/leadReply.ts), which check the same.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireTodoUser(false, "prospects");
    const id = new URL(request.url).searchParams.get("id");
    if (id !== null) {
      const page = await prospectData(id);
      if (!page) throw new TodoError(404, "That prospect is no longer in the CRM.");
      return Response.json(page, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await crmListData(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
