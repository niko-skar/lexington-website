import { reporterData } from "@/lib/agents/progress";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/updates (11 Nov 2026): what the site app's Site updates part needs (the progress reporter, lib/agents/progress):
 * the stage names used so far, the last few updates, and whether Claude and Facebook/Instagram are connected. The office
 * only. Photos go up through /api/admin/progress/upload; the update is written and published by lib/actions/progress.ts.
 */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "updates");
    return Response.json(await reporterData(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
