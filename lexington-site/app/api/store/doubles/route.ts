import { findDoubles } from "@/lib/store/doublesCheck";
import { errorResponse, readJson, requireTodoUser, TodoError } from "@/lib/todo/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PHOTO_RE = /^image-[a-f0-9]{40}-\d+x\d+-(jpg|png|webp)$/;

/**
 * POST /api/store/doubles { kind: item | tool, name, photoId?, unit?, count?, category? }: what that might be a double
 * of, before it's added (lib/store/doublesCheck.ts). A photo still uploading ("pending:") is left out: names only then.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireTodoUser(false, "store");
    const body = await readJson(request);
    if (body.kind !== "item" && body.kind !== "tool") throw new TodoError(400, "Unknown kind.");
    const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    const found = await findDoubles({
      kind: body.kind,
      name,
      photoId: typeof body.photoId === "string" && PHOTO_RE.test(body.photoId) ? body.photoId : null,
      unit: typeof body.unit === "string" ? body.unit.slice(0, 20) : null,
      count: typeof body.count === "number" && Number.isFinite(body.count) ? body.count : null,
      category: typeof body.category === "string" ? body.category.slice(0, 40) : null,
    });
    return Response.json(found, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
