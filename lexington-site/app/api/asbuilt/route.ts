import { isRealRecord, readFloors } from "@/lib/asbuilt/store";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/asbuilt (10 Nov 2026): the as-built record for the site app's As-built part: every floor with its recent
 * changes (lib/asbuilt). The office only. Changes are saved by the record's own action (lib/actions/asbuilt.ts).
 */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "asbuilt");
    return Response.json({ floors: await readFloors(), real: isRealRecord() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
