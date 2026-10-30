import { requireRollcallUser } from "@/lib/rollcall/server";
import { rollcallAccess } from "@/lib/rollcall/shared";
import { dropPhoto, errorResponse, storePhoto, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";

// The roll call's photos (a worker's ID card, curing found dry) in the private image store, named "rollcall-…".

/** POST (form with "file"): stores a photo, answers its id. */
export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireRollcallUser();
    const can = rollcallAccess(me.sections);
    if (!can.rollcall && !can.workers) throw new TodoError(403, "This login can't add photos here.");
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new TodoError(400, "No photo was sent.");
    const { id } = await storePhoto(file, "rollcall");
    return Response.json({ id });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE ?id=: a photo taken off (replaced, or the record it proved was removed). */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const me = await requireRollcallUser();
    const can = rollcallAccess(me.sections);
    if (!can.rollcall && !can.workers) throw new TodoError(403, "This login can't remove photos here.");
    await dropPhoto(new URL(request.url).searchParams.get("id") || "", "rollcall");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
