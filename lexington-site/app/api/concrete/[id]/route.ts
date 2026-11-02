import { listPours } from "@/lib/concrete/pours";
import { changeTruck, deleteTruck } from "@/lib/concrete/server";
import { errorResponse, readJson, requireTodoUser } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** PATCH /api/concrete/:id: the waybill's details, the times, slump, cubes, comment; { pourId } its pour; or { action: "read" } to read the waybill again. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "concrete");
    const { id } = await params;
    const body = await readJson(request);
    const truck = await changeTruck(me, id, body);
    return Response.json({ truck, ...("pourId" in body ? { pours: await listPours() } : {}) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/concrete/:id: off the list with its photo. The office; a site login the trucks it logged. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "concrete");
    const { id } = await params;
    await deleteTruck(me, id);
    // Its pour may be back before its pour.
    return Response.json({ ok: true, pours: await listPours() });
  } catch (error) {
    return errorResponse(error);
  }
}
