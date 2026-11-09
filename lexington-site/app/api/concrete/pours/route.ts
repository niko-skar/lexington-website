import { addPourPhoto, attachCubeForm, deletePourPhoto, setCubeResult, setCubes } from "@/lib/concrete/pourFiles";
import { bookPour, changePour, deletePour, orderPour, pourDone, tickPour } from "@/lib/concrete/pours";
import { concreteData } from "@/lib/concrete/server";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/concrete/pours (2 Nov 2026, lib/concrete/pours.ts): a pour booked { action: "book", day, what, mix?,
 * volume?, checklist?, curer?, estimate? }, changed { action: "change", id, ..., estimate? (null takes it off) }, its
 * order to the concrete company sent or copied { action: "order", id, order } (lib/concrete/estimate.ts),
 * a check ticked { action: "tick", id, key, ok },
 * poured by hand { action: "poured", id, day? } or taken off { action: "delete", id }; its photos { action: "photo",
 * pourId, kind, previewId, original: { url, pathname, bytes?, width?, height? }, takenAt? } and { action: "photoDelete",
 * id }; its cubes { action: "cubes", pourId, taken?, target? }, a test's results { action: "cubeResult", pourId, age,
 * testedOn, strengths } or the lab's form { action: "cubeForm", pourId, age, formId }. Anyone who opens Concrete.
 * Answers with the concrete page's data as it is now.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "concrete");
    const body = await readJson(request);
    if (body.action === "book") await bookPour(me, body);
    else if (body.action === "change") await changePour(me, body.id, body);
    else if (body.action === "order") await orderPour(me, body.id, body.order);
    else if (body.action === "tick") await tickPour(me, body.id, body.key, body.ok);
    else if (body.action === "poured") await pourDone(me, body.id, body.day);
    else if (body.action === "delete") await deletePour(me, body.id);
    else if (body.action === "photo") await addPourPhoto(me, body);
    else if (body.action === "photoDelete") await deletePourPhoto(me, body.id);
    else if (body.action === "cubes") await setCubes(me, body);
    else if (body.action === "cubeResult") await setCubeResult(me, body);
    else if (body.action === "cubeForm") await attachCubeForm(me, body);
    else throw new TodoError(400, "That button isn't known.");
    return Response.json(await concreteData());
  } catch (error) {
    return errorResponse(error);
  }
}
