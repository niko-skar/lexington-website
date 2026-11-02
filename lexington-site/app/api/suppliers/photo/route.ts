import { dropPhoto, errorResponse, requireTodoUser, storePhoto, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/suppliers/photo: a photo of a supplier's bill from the phone (already shrunk there), into the private store. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "suppliers");
    let file: FormDataEntryValue | null = null;
    try {
      file = (await request.formData()).get("photo");
    } catch {
      throw new TodoError(400, "No photo was sent.");
    }
    if (!(file instanceof File)) throw new TodoError(400, "No photo was sent.");
    return Response.json(await storePhoto(file, "bill"));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/suppliers/photo?id=: a bill photo that never went on a bill (only if nothing uses it). */
export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireTodoUser(true, "suppliers");
    await dropPhoto(new URL(request.url).searchParams.get("id") || "", "bill");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
