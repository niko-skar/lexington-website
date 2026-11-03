import { randomBytes } from "node:crypto";

import { getBuyersClient } from "@/lib/sanity/buyersClient";
import { errorResponse, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 4_400_000;
const TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** POST /api/concrete/form: a lab's cube results form (a photo, shrunk on the phone, or a PDF) into the private store. */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(false, "concrete");
    let file: FormDataEntryValue | null = null;
    try {
      file = (await request.formData()).get("file");
    } catch {
      throw new TodoError(400, "No form was sent.");
    }
    if (!(file instanceof File)) throw new TodoError(400, "No form was sent.");
    if (!TYPES.includes(file.type)) throw new TodoError(415, "That file can't be attached. Use a photo or a PDF.");
    if (file.size === 0) throw new TodoError(400, "No form was sent.");
    if (file.size > MAX_BYTES) throw new TodoError(413, "That form is too big (over 4 MB): take a photo of it instead.");
    const pdf = file.type === "application/pdf";
    const ext = pdf ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const asset = await getBuyersClient().assets.upload(pdf ? "file" : "image", Buffer.from(await file.arrayBuffer()), {
      filename: `concrete-cubes-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}.${ext}`,
      contentType: file.type,
    });
    return Response.json({ id: asset._id, url: asset.url, type: file.type });
  } catch (error) {
    return errorResponse(error);
  }
}
