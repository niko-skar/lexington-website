import { createTruck, getTruck, listConcrete } from "@/lib/concrete/server";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
// The waybill is read once the answer has gone (after()): that takes Claude a few seconds.
export const maxDuration = 120;

/** GET /api/concrete: the trucks and pour days of the last four months; ?id= one truck (while its waybill is read). */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireTodoUser(false, "concrete");
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const truck = await getTruck(id);
      if (!truck) throw new TodoError(404, "That truck isn't on the list any more.");
      return Response.json({ truck }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await listConcrete(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/concrete { photoId, arrivedAt, arrivedFrom }: a truck from the photo of its waybill (read in the background). */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "concrete");
    const truck = await createTruck(me, await readJson(request));
    return Response.json({ truck }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
