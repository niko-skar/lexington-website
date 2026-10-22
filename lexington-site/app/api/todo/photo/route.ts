import { dropPhoto, errorResponse, requireTodoUser, storePhoto, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/todo/photo: one photo from the phone (already shrunk there), into the private store. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser();
    let file: FormDataEntryValue | null = null;
    try {
      file = (await request.formData()).get("photo");
    } catch {
      throw new TodoError(400, "No photo was sent.");
    }
    if (!(file instanceof File)) throw new TodoError(400, "No photo was sent.");
    return Response.json(await storePhoto(file));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/todo/photo?id=: a photo taken and then removed before saving (only if nothing uses it). */
export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireTodoUser();
    const id = new URL(request.url).searchParams.get("id") || "";
    await dropPhoto(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
