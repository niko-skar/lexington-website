import { setPourDay } from "@/lib/concrete/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** POST /api/concrete/day { day, pour, mix, volume }: what was poured that day and what was ordered. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(false, "concrete");
    return Response.json({ day: await setPourDay(await readJson(request)) });
  } catch (error) {
    return errorResponse(error);
  }
}
