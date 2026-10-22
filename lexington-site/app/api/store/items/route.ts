import { createItem } from "@/lib/store/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** POST /api/store/items { name, unit, count }: something new on the shelves, with how many there are. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json({ item: await createItem(me, await readJson(request)) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
