import { setReorderGot } from "@/lib/store/shoppingServer";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/** POST /api/store/buys/reorder { itemId, got }: a store item at its reorder point bought, or to buy again. Answers { item }. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "store");
    return Response.json(await setReorderGot(me, await readJson(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
