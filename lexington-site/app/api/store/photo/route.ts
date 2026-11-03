import { dropPhoto, errorResponse, photoUpload, requireTodoUser, storePhoto } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/store/photo: a photo of stock (shrunk on the phone first), into the private store. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(false, "store");
    const { file, ticket } = await photoUpload(request);
    return Response.json(await storePhoto(file, "store", ticket));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/store/photo?id=: a photo taken and then dropped before saving (only if nothing uses it). */
export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireTodoUser(false, "store");
    await dropPhoto(new URL(request.url).searchParams.get("id") || "", "store");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
