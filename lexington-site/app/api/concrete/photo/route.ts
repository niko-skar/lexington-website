import { dropPhoto, errorResponse, photoUpload, requireTodoUser, storePhoto } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/concrete/photo: a waybill photo from the phone (already shrunk there), into the private store. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(false, "concrete");
    const { file, ticket } = await photoUpload(request);
    return Response.json(await storePhoto(file, "concrete", ticket));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/concrete/photo?id=: a waybill photo that never became a truck (only if nothing uses it). */
export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireTodoUser(false, "concrete");
    await dropPhoto(new URL(request.url).searchParams.get("id") || "", "concrete");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
