import { bookPour, changePour, deletePour, pourDone, tickPour } from "@/lib/concrete/pours";
import { concreteData } from "@/lib/concrete/server";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/concrete/pours (2 Nov 2026, lib/concrete/pours.ts): a pour booked { action: "book", day, what, mix?,
 * volume?, checklist?, curer? }, changed { action: "change", id, ... }, a check ticked { action: "tick", id, key, ok },
 * poured by hand { action: "poured", id, day? } or taken off { action: "delete", id }. Anyone who opens Concrete.
 * Answers with the concrete page's data as it is now.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireTodoUser(false, "concrete");
    const body = await readJson(request);
    if (body.action === "book") await bookPour(me, body);
    else if (body.action === "change") await changePour(me, body.id, body);
    else if (body.action === "tick") await tickPour(me, body.id, body.key, body.ok);
    else if (body.action === "poured") await pourDone(me, body.id, body.day);
    else if (body.action === "delete") await deletePour(me, body.id);
    else throw new TodoError(400, "That button isn't known.");
    return Response.json(await concreteData());
  } catch (error) {
    return errorResponse(error);
  }
}
