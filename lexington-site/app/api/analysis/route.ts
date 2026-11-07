import { analysisData } from "@/lib/analysis/server";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/analysis: how the money's going, and every material bought, counted (lib/analysis). The office only. */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(true, "analysis");
    return Response.json(await analysisData(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
