import { estimateFloors } from "@/lib/concrete/estimateServer";
import { errorResponse, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/concrete/estimate (9 Nov 2026, lib/concrete/estimate.ts): every floor of the building as the concrete
 * estimate needs it (grid, slab outline, columns, walls, lift cores, openings), from the as-built record. Anyone who
 * opens Concrete.
 */
export async function GET(): Promise<Response> {
  try {
    await requireTodoUser(false, "concrete");
    return Response.json({ floors: await estimateFloors() });
  } catch (error) {
    return errorResponse(error);
  }
}
