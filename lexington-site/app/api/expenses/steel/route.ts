import { setSteel } from "@/lib/expenses/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** POST /api/expenses/steel { id, tons } or { rate }: the steel card's tons on an entry, or the rate a ton. The office only. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "expenses");
    return Response.json(await setSteel(await readJson(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
