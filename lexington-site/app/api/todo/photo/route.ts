import { dropPhoto, errorResponse, photoUpload, requireTodoUser, storePhoto } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/todo/photo: one photo from the phone (already shrunk there), into the private store. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser();
    const { file, ticket } = await photoUpload(request);
    return Response.json(await storePhoto(file, "todo", ticket));
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
